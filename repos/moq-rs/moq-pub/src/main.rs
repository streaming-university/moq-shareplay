use bytes::{Bytes, BytesMut};
use log::info;
use std::{env, fs, net, path::PathBuf};
use url::Url;
use std::io::Cursor;
use bincode;
use anyhow::Context;
use clap::Parser;
use tokio::time::{Duration, Instant};
use tokio::{fs::File, io::AsyncReadExt, io::BufReader};
use mp4::{self, ReadBox, TrackType};
use moq_native::quic;
use moq_pub::{Media, SubToSync};
use moq_transport::{serve, serve::Tracks, session::Publisher};
use moq_transport::session::Subscriber;
use moq_transport::serve::{TrackReaderMode, TracksReader};
use futures_util::StreamExt;
use futures_util::sink::SinkExt; // Required for `.send()` on split WebSocket
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tokio::sync::{watch, Mutex};
use std::sync::Arc;
// use moq_transport::serve::Tracks;

#[derive(Parser, Clone)]
pub struct Cli {
	/// Listen for UDP packets on the given address.
	#[arg(long, default_value = "[::]:0")]
	pub bind: net::SocketAddr,

	/// Advertise this frame rate in the catalog (informational)
	// TODO auto-detect this from the input when not provided
	#[arg(long, default_value = "24")]
	pub fps: u8,

	/// Advertise this bit rate in the catalog (informational)
	// TODO auto-detect this from the input when not provided
	#[arg(long, default_value = "1500000")]
	pub bitrate: u32,

	/// Connect to the given URL starting with https://
	#[arg()]
	pub url: Url,

	/// The name of the broadcast
	#[arg(long)]
	pub name: String,

	/// The TLS configuration.
	#[command(flatten)]
	pub tls: moq_native::tls::Args,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    env_logger::init();

    // Disable tracing to suppress Quinn debug output
    let tracer = tracing_subscriber::FmtSubscriber::builder()
        .with_max_level(tracing::Level::WARN)
        .finish();
    tracing::subscriber::set_global_default(tracer).unwrap();

    let cli = Cli::parse();

    let (writer, _, reader) = serve::Tracks::new(cli.name.clone()).produce();
    let media = Media::new(writer)?;

    let tls = cli.tls.load()?;
    let quic = quic::Endpoint::new(moq_native::quic::Config {
        bind: cli.bind,
        tls: tls.clone(),
    })?;

    log::info!("Connecting to relay: url={}", cli.url);
    let session = quic.client.connect(&cli.url).await?;

    let (session, mut publisher, subscriber) = moq_transport::session::Session::connect(session)
        .await
        .context("failed to establish forward session")?;

    let tracks = Tracks::new(format!("sync-namespace-{}", cli.name));
    let mut syncer = SubToSync::new(&subscriber, tracks).await?;

    let (sync_value_tx, sync_value_rx) = watch::channel(String::new());
    let sync_value_rx_locked = Arc::new(Mutex::new(sync_value_rx.clone()));

    // 👇 Store a handle to the currently running syncer task (can be replaced)
    let current_syncer_task = Arc::new(Mutex::new(None::<tokio::task::JoinHandle<anyhow::Result<()>>>));
    let subscriber = Arc::new(subscriber);

    {
        let sync_value_tx = sync_value_tx.clone();
        let current_syncer_task = Arc::clone(&current_syncer_task);
        let subscriber = Arc::clone(&subscriber);
        let cli_name = cli.name.clone();


        // 🔌 WebSocket client: connects to ws://localhost:8080 and listens
        tokio::spawn(async move {
            let url = Url::parse("ws://localhost:8080").expect("Invalid WebSocket URL");
            let (ws_stream, _) = connect_async(url).await.expect("WebSocket connection failed");
            println!("🔗 WebSocket connected.");

            let (mut write, mut read) = ws_stream.split();

            let pub_name = if cli_name.starts_with("room") {
				format!("pub{}", &cli_name["room".len()..])
			} else {
				"pub1".to_string() // fallback default
			};

			if let Err(e) = write.send(Message::Text(pub_name.clone())).await {
				eprintln!("❌ Failed to send '{}': {}", pub_name, e);
			} else {
				println!("✅ Sent '{}' to WebSocket server.", pub_name);
			}

			while let Some(msg) = read.next().await {
				match msg {
					Ok(Message::Text(text)) => {
						if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
							if json["type"] == "namespace-update" {
								let new_namespace = json["newNamespace"].as_str().unwrap_or_default();
								log::info!("🔁 Received namespace-update: {}", new_namespace);

								let new_tracks = Tracks::new(new_namespace.to_string());
								match SubToSync::new(&*subscriber, new_tracks).await {
									Ok(mut new_syncer) => {
										let tx_clone = sync_value_tx.clone();

										if let Some(handle) = current_syncer_task.lock().await.take() {
											handle.abort();
										}

										let handle = tokio::spawn(async move {
											new_syncer.run_with_a_channel(tx_clone).await
										});

										*current_syncer_task.lock().await = Some(handle);
									}
									Err(e) => {
										log::error!("❌ Failed to create new syncer: {:?}", e);
									}
								}
							}
						} else {
							log::info!("📩 WebSocket message: {}", text);
						}
                    }
                    Ok(_) => {}
                    Err(e) => {
                        log::error!("WebSocket error: {}", e);
                        break;
                    }
                }
            }
        });
    }

    // 🟢 Log sync messages from MoQ track
    let sync_value_rx_clone = Arc::clone(&sync_value_rx_locked);
    tokio::spawn(async move {
        let mut rx = sync_value_rx_clone.lock().await;
        while rx.changed().await.is_ok() {
            let value = rx.borrow();
            println!("🟢 Received message in moq-pub: {}", *value);
        }
    });

    // Start the initial syncer task
    let initial_syncer_task = tokio::spawn({
        let tx = sync_value_tx.clone();
        async move {
            syncer.run_with_a_channel(tx).await
        }
    });
    *current_syncer_task.lock().await = Some(initial_syncer_task);

    // Run MoQ session and media
    tokio::select! {
        res = session.run() => res.context("session error")?,
        res = run_media_from_group_with_a_channel(media, Some(0), Some(0), sync_value_rx.clone()) => res.context("media error")?,
        res = publisher.announce(reader) => res.context("publisher error")?,
    }

    Ok(())
}





// pub async fn subscribe_sync_track(mut broadcast: TracksReader) -> anyhow::Result<()> {
//     // Subscribe to the existing sync-track (already in the sync-namespace)
//     let track = broadcast.subscribe("sync-track").context("no sync track")?;

//     // Expect the track to be in groups mode
//     if let TrackReaderMode::Groups(mut groups) = track.mode().await? {
//         while let Some(mut group) = groups.next().await? {
//             while let Some(object) = group.next().await? {
//                 // Use the existing recv_object function
//                 let data = recv_object(object).await?;
//                 // Do something with the data. For example, print it:
//                 println!("Received data on sync-track: {:?}", data);
//             }
//         }
//     } else {
//         anyhow::bail!("sync-track did not provide groups mode");
//     }

//     Ok(())
// }

// // Use the existing recv_object function as defined in the original code:
// async fn recv_object(mut object: moq_transport::serve::GroupObjectReader) -> anyhow::Result<Vec<u8>> {
//     let mut buf = Vec::with_capacity(object.size);
//     while let Some(chunk) = object.read().await? {
//         buf.extend_from_slice(&chunk);
//     }
//     Ok(buf)
// }



async fn load_keyframes_from_file(filename: &str) -> anyhow::Result<Vec<i32>> {
    let file = File::open(filename)
        .await
        .with_context(|| format!("Failed to open file: {}", filename))?;

    let mut reader = BufReader::new(file);

    let mut buffer = Vec::new();
    reader.read_to_end(&mut buffer).await
        .with_context(|| "Failed to read file contents")?;

    let keyframe_indexes: Vec<i32> = bincode::deserialize(&buffer)
        .with_context(|| "Failed to deserialize keyframe indexes")?;

    Ok(keyframe_indexes)
}

async fn run_media_from_group_with_a_channel(mut media: Media, start_group: Option<u32>, start_object: Option<u32>, mut sync_value_rx: watch::Receiver<String>,) -> anyhow::Result<()> {
	loop{

	log::debug!(
		"Starting run_media with mdat : {:?}  request",
		start_group
	);


	let keyframe_indexes = load_keyframes_from_file("keyframes.bin").await.unwrap();
	//log::info!("{:?}", keyframe_indexes);
	//log:info!("The second 2 is corresponding to: {:?}" ,keyframe_indexes.get(2));



	let dir_path = env::current_dir()?.join("atoms");
	let dir = dir_path.to_str().unwrap();

	let mut atom_files: Vec<PathBuf> = fs::read_dir(dir)
		.context("Failed to read atom directory")?
		.filter_map(|entry| entry.ok().map(|e| e.path()))
		.filter(|path| {
			let file_name = path.file_name().unwrap().to_str().unwrap();
			file_name.contains('_') && file_name.split('_').next().unwrap().parse::<u32>().is_ok()
		})
		.collect();

	atom_files.sort_by_key(|path| {
		let file_name = path.file_name().unwrap().to_str().unwrap();
		file_name.split('_').next().unwrap().parse::<u32>().unwrap()
	});

	let mut init_atoms = Vec::new();
	let mut frame_atoms = Vec::new();
	let mut frame_atoms_for_playback:Vec<PathBuf> = Vec::new();

	for file_path in atom_files {
		let file_name = file_path.file_name().unwrap().to_str().unwrap();
		if file_name.contains("ftyp") || file_name.contains("moov") {
			init_atoms.push(file_path);
		} else if file_name.contains("moof") || file_name.contains("mdat") {
			frame_atoms.push(file_path.clone());
			frame_atoms_for_playback.push(file_path);
		}
	}

	let mut atoms = Vec::new();
	for init_atom in init_atoms {
		let mut file = File::open(&init_atom).await.context("Failed to open init atom file")?;
		let mut atom_data = Vec::new();
		file.read_to_end(&mut atom_data)
			.await
			.context("Failed to read init atom file")?;
		atoms.push(Bytes::from(atom_data));
	}
	log::debug!("Sending initialization atoms to media.");
	media.read_atoms_directly(atoms)?;

	let mut frame_index = 0;
	if let Some(start_group) = start_group {
		//log::debug!("Finding start_group: {}", start_group);
		for (index, frame_path) in frame_atoms.iter().enumerate() {
			let file_name = frame_path.file_name().unwrap().to_str().unwrap();
			if let Ok(group_number) = file_name.split('_').next().unwrap().parse::<u32>() {
				//log::debug!("Found group: {} at index {}", group_number, index);
				if group_number >= start_group {
					frame_index = index;
					break;
				}
			}
		}
	}
	log::debug!("Starting playback from frame index: {}", frame_index);

	frame_atoms_for_playback = frame_atoms.iter().cloned().skip(frame_index).collect();
	//log::debug!("Frames after skipping: {:?}", frame_atoms);

	let batch_size = 2;
	let target_fps = 85.0;
	let frame_delay = Duration::from_secs_f64(1.0 / target_fps);
	let batch_delay = frame_delay * batch_size as u32;

	let start_time = Instant::now();
	let mut total_frames = 0;
	let mut play = true;

	let mut remaining_frames = frame_atoms_for_playback.len();

	 while ( total_frames < frame_atoms.len()) {
		let mut batch = Vec::new();
		//log::info!("Frame index is: {}, frame atoms length is: {}", frame_index, frame_atoms.len());
		if frame_index+total_frames+2 >= frame_atoms.len() {
				log::info!("End of video reached. Restarting playback from beginning...");

				frame_index = 0;
				total_frames = 0;
				frame_atoms_for_playback = frame_atoms.clone();
			}


		//log::info!("Total frames is: {}, frame atoms length is: {}", total_frames, frame_atoms.len());

		if !play {
			log::info!("Playback paused. Waiting for resume signal...");
			while sync_value_rx.changed().await.is_ok() {
				let new_value = sync_value_rx.borrow();

				if *new_value == "play" {
					log::info!("Resuming playback...");
					play = true;
					break;
				}

				if let Ok(new_start_group) = new_value.parse::<u32>() {
					frame_index = 0;
					total_frames = 0;


					if let Some(&new_keyframe) = keyframe_indexes.get(new_start_group as usize) {
						if new_keyframe >= 0 {
							frame_index = new_keyframe as usize;
							frame_index -= 2;

							frame_atoms_for_playback = frame_atoms.iter().cloned().skip(frame_index).collect();
							remaining_frames = frame_atoms_for_playback.len();

							log::info!(
								"Updated frame_atoms for new start_group: {} (mapped to keyframe: {}) at index {}",
								new_start_group, new_keyframe, frame_index
							);
						} else {
							log::warn!(
								"Keyframe index is negative for new start_group: {}, skipping seek.",
								new_start_group
							);
						}
					} else {
						log::warn!(
							"No matching keyframe found for new_start_group: {}, frame index not updated",
							new_start_group
						);
					}
				} else {
					log::warn!(
						"Failed to parse new_start_group from sync_value_rx: {}",
						*new_value
					);
					break;
				}
			}
		}


		while sync_value_rx.has_changed().unwrap_or(false) {
			if sync_value_rx.changed().await.is_ok() {
				let new_value = sync_value_rx.borrow();
				log::info!("Received new start_group: {}", *new_value);

				if *new_value == "pause" {
					play = false;
				}


				if let Ok(new_start_group) = new_value.parse::<u32>() {
					frame_index = 0;
					total_frames = 0;


					if let Some(&new_keyframe) = keyframe_indexes.get(new_start_group as usize) {
						if new_keyframe >= 0 {
							frame_index = new_keyframe as usize;
							frame_index -= 2;

							frame_atoms_for_playback = frame_atoms.iter().cloned().skip(frame_index).collect();
							remaining_frames = frame_atoms_for_playback.len();

							log::info!(
								"Updated frame_atoms for new start_group: {} (mapped to keyframe: {}) at index {}",
								new_start_group, new_keyframe, frame_index
							);
						} else {
							log::warn!(
								"Keyframe index is negative for new start_group: {}, skipping seek.",
								new_start_group
							);
						}
					} else {
						log::warn!(
							"No matching keyframe found for new_start_group: {}, frame index not updated",
							new_start_group
						);
					}
				} else {
					log::warn!(
						"Failed to parse new_start_group from sync_value_rx: {}",
						*new_value
					);
					break;
				}
			}
		}


		for _ in 0..batch_size {
			if total_frames < frame_atoms_for_playback.len() {
				let mut frame_pair = Vec::new();

				for offset in 0..2 {
					if total_frames + offset < frame_atoms_for_playback.len() {
						let mut file = File::open(&frame_atoms_for_playback[total_frames + offset])
							.await
							.context("Failed to open frame atom file")?;
						let mut atom_data = Vec::new();
						file.read_to_end(&mut atom_data).await?;
						frame_pair.push(Bytes::from(atom_data));
					}
				}

				batch.push(frame_pair);
				total_frames += 2;
			}

	}

		// Send frames to media
		for frame_pair in batch {
			media.read_atoms_directly(frame_pair)?;
		}

		// Log playback metrics
		let elapsed = start_time.elapsed().as_secs_f64();
		let fps = total_frames as f64 / elapsed;
		tokio::time::sleep(batch_delay).await;
	}

	}


	log::debug!("Completed playback for all frames.");
	Ok(())
}

async fn run_media_from_group_with_a_channel_2(mut media: Media, start_group: Option<u32>, start_object: Option<u32>, mut sync_value_rx: watch::Receiver<String>,) -> anyhow::Result<()> {
	log::debug!(
		"Starting run_media with start_group: {:?}, start_object: {:?}",
		start_group,
		start_object
	);

	// Directory containing atom files
	let dir_path = env::current_dir()?.join("atoms");
	let dir = dir_path.to_str().unwrap();

	// Collect and sort atom files
	let mut atom_files: Vec<PathBuf> = fs::read_dir(dir)
		.context("Failed to read atom directory")?
		.filter_map(|entry| entry.ok().map(|e| e.path()))
		.filter(|path| {
			let file_name = path.file_name().unwrap().to_str().unwrap();
			file_name.contains('_') && file_name.split('_').next().unwrap().parse::<u32>().is_ok()
		})
		.collect();

	atom_files.sort_by_key(|path| {
		let file_name = path.file_name().unwrap().to_str().unwrap();
		file_name.split('_').next().unwrap().parse::<u32>().unwrap()
	});

	//log::debug!("Sorted atom files: {:?}", atom_files);

	// Separate initialization and frame atoms
	let mut init_atoms = Vec::new();
	let mut frame_atoms = Vec::new();

	for file_path in atom_files {
		let file_name = file_path.file_name().unwrap().to_str().unwrap();
		if file_name.contains("ftyp") || file_name.contains("moov") {
			init_atoms.push(file_path);
		} else if file_name.contains("moof") || file_name.contains("mdat") {
			frame_atoms.push(file_path);
		}
	}

	//log::debug!("Initialization atoms: {:?}", init_atoms);
	//log::debug!("Frame atoms: {:?}", frame_atoms);

	// Send initialization atoms only once
	let mut atoms = Vec::new();
	for init_atom in init_atoms {
		let mut file = File::open(&init_atom).await.context("Failed to open init atom file")?;
		let mut atom_data = Vec::new();
		file.read_to_end(&mut atom_data)
			.await
			.context("Failed to read init atom file")?;
		atoms.push(Bytes::from(atom_data));
		//log::debug!("Read init atom: {:?}", init_atom);
	}
	log::debug!("Sending initialization atoms to media.");
	media.read_atoms_directly(atoms)?;

	// Determine the starting frame index
	let mut frame_index = 0;
	if let Some(start_group) = start_group {
		// log::debug!("Finding start_group: {}", start_group);
		for (index, frame_path) in frame_atoms.iter().enumerate() {
			let file_name = frame_path.file_name().unwrap().to_str().unwrap();
			if let Ok(group_number) = file_name.split('_').next().unwrap().parse::<u32>() {
				//log::debug!("Found group: {} at index {}", group_number, index);
				if group_number >= start_group {
					frame_index = index;
					break;
				}
			}
		}
	}
	log::debug!("Starting playback from frame index: {}", frame_index);

	// Skip all frames before the start index
	frame_atoms = frame_atoms.into_iter().skip(frame_index).collect();
	//log::debug!("Frames after skipping: {:?}", frame_atoms);

	// Playback parameters
	let batch_size = 1;
	let target_fps = 88.0;
	let frame_delay = Duration::from_secs_f64(1.0 / target_fps);
	let batch_delay = frame_delay * batch_size as u32;

	// Start playback loop
	let start_time = Instant::now();
	let mut total_frames = 0;

	while total_frames < frame_atoms.len() {
		let mut batch = Vec::new();

		// Collect a batch of frames
		for _ in 0..batch_size {
			if total_frames < frame_atoms.len()
				&& frame_atoms[total_frames]
					.file_name()
					.unwrap()
					.to_str()
					.unwrap()
					.contains("moof")
			{
				let mut frame_pair = Vec::new();

				for offset in 0..2 {
					if total_frames + offset < frame_atoms.len() {
						let mut file = File::open(&frame_atoms[total_frames + offset])
							.await
							.context("Failed to open frame atom file")?;
						let mut atom_data = Vec::new();
						file.read_to_end(&mut atom_data)
							.await
							.context("Failed to read frame atom file")?;
						frame_pair.push(Bytes::from(atom_data));
					}
				}
				batch.push(frame_pair);
				total_frames += 2;
			} else {
				total_frames += 1;
			}
		}

		// Send frames to media
		for frame_pair in batch {
			media.read_atoms_directly(frame_pair)?;
		}

		// Log playback metrics
		let elapsed = start_time.elapsed().as_secs_f64();
		let fps = total_frames as f64 / elapsed;

		tokio::time::sleep(batch_delay).await;
	}

	log::debug!("Completed playback for all frames.");
	Ok(())
}

async fn run_media_from_group(mut media: Media, start_group: Option<u32>, start_object: Option<u32>) -> anyhow::Result<()> {
	log::debug!(
		"Starting run_media with start_group: {:?}, start_object: {:?}",
		start_group,
		start_object
	);

	// Directory containing atom files
	let dir_path = env::current_dir()?.join("atoms");
	let dir = dir_path.to_str().unwrap();

	// Collect and sort atom files
	let mut atom_files: Vec<PathBuf> = fs::read_dir(dir)
		.context("Failed to read atom directory")?
		.filter_map(|entry| entry.ok().map(|e| e.path()))
		.filter(|path| {
			let file_name = path.file_name().unwrap().to_str().unwrap();
			file_name.contains('_') && file_name.split('_').next().unwrap().parse::<u32>().is_ok()
		})
		.collect();

	atom_files.sort_by_key(|path| {
		let file_name = path.file_name().unwrap().to_str().unwrap();
		file_name.split('_').next().unwrap().parse::<u32>().unwrap()
	});

	//log::debug!("Sorted atom files: {:?}", atom_files);

	// Separate initialization and frame atoms
	let mut init_atoms = Vec::new();
	let mut frame_atoms = Vec::new();

	for file_path in atom_files {
		let file_name = file_path.file_name().unwrap().to_str().unwrap();
		if file_name.contains("ftyp") || file_name.contains("moov") {
			init_atoms.push(file_path);
		} else if file_name.contains("moof") || file_name.contains("mdat") {
			frame_atoms.push(file_path);
		}
	}

	//log::debug!("Initialization atoms: {:?}", init_atoms);
	//log::debug!("Frame atoms: {:?}", frame_atoms);

	// Send initialization atoms only once
	let mut atoms = Vec::new();
	for init_atom in init_atoms {
		let mut file = File::open(&init_atom).await.context("Failed to open init atom file")?;
		let mut atom_data = Vec::new();
		file.read_to_end(&mut atom_data)
			.await
			.context("Failed to read init atom file")?;
		atoms.push(Bytes::from(atom_data));
		//log::debug!("Read init atom: {:?}", init_atom);
	}
	log::debug!("Sending initialization atoms to media.");
	media.read_atoms_directly(atoms)?;

	// Determine the starting frame index
	let mut frame_index = 0;
	if let Some(start_group) = start_group {
		// log::debug!("Finding start_group: {}", start_group);
		for (index, frame_path) in frame_atoms.iter().enumerate() {
			let file_name = frame_path.file_name().unwrap().to_str().unwrap();
			if let Ok(group_number) = file_name.split('_').next().unwrap().parse::<u32>() {
				//log::debug!("Found group: {} at index {}", group_number, index);
				if group_number >= start_group {
					frame_index = index;
					break;
				}
			}
		}
	}
	log::debug!("Starting playback from frame index: {}", frame_index);

	// Skip all frames before the start index
	frame_atoms = frame_atoms.into_iter().skip(frame_index).collect();
	//log::debug!("Frames after skipping: {:?}", frame_atoms);

	// Playback parameters
	let batch_size = 1;
	let target_fps = 86.0;
	let frame_delay = Duration::from_secs_f64(1.0 / target_fps);
	let batch_delay = frame_delay * batch_size as u32;

	// Start playback loop
	let start_time = Instant::now();
	let mut total_frames = 0;

	while total_frames < frame_atoms.len() {
		let mut batch = Vec::new();

		// Collect a batch of frames
		for _ in 0..batch_size {
			if total_frames < frame_atoms.len()
				&& frame_atoms[total_frames]
					.file_name()
					.unwrap()
					.to_str()
					.unwrap()
					.contains("moof")
			{

				let mut frame_pair = Vec::new();

				for offset in 0..2 {
					if total_frames + offset < frame_atoms.len() {
						let mut file = File::open(&frame_atoms[total_frames + offset])
							.await
							.context("Failed to open frame atom file")?;
						let mut atom_data = Vec::new();
						file.read_to_end(&mut atom_data)
							.await
							.context("Failed to read frame atom file")?;
						frame_pair.push(Bytes::from(atom_data));
					}
				}
				batch.push(frame_pair);
				total_frames += 2;
			} else {
				total_frames += 1;
			}
		}

		// Send frames to media
		for frame_pair in batch {
			media.read_atoms_directly(frame_pair)?;
		}

		// Log playback metrics
		let elapsed = start_time.elapsed().as_secs_f64();
		let fps = total_frames as f64 / elapsed;

		tokio::time::sleep(batch_delay).await;
	}

	log::debug!("Completed playback for all frames.");
	Ok(())
}

async fn run_media(mut media: Media) -> anyhow::Result<()> {
	//TODO: The saving logic of the atoms should be moved to pipe
	let dir_path = env::current_dir()?.join("atoms");
	let dir = dir_path.to_str().unwrap();

	// Collect and sort atom files by sequence number from the saved directory.
	let mut atom_files: Vec<PathBuf> = fs::read_dir(dir)?
		.filter_map(|entry| entry.ok().map(|e| e.path()))
		.filter(|path| {
			let file_name = path.file_name().unwrap().to_str().unwrap();
			file_name.contains('_') && file_name.split('_').next().unwrap().parse::<u32>().is_ok()
		})
		.collect();
	atom_files.sort_by_key(|path| {
		let file_name = path.file_name().unwrap().to_str().unwrap();
		file_name.split('_').next().unwrap().parse::<u32>().unwrap()
	});

	// Initialize and Frame atoms should be seperated to avoid mistakes in the media rs's read_atom function
	let mut init_atoms = Vec::new();
	let mut frame_atoms = Vec::new();

	for file_path in atom_files {
		let file_name = file_path.file_name().unwrap().to_str().unwrap();
		if file_name.contains("ftyp") || file_name.contains("moov") {
			init_atoms.push(file_path);
		} else if file_name.contains("moof") || file_name.contains("mdat") {
			frame_atoms.push(file_path);
		}
	}

	// The initialization atoms must be send only once
	let mut atoms = Vec::new();
	for init_atom in init_atoms {
		let mut file = File::open(&init_atom).await.context("Failed to open init atom file")?;
		let mut atom_data = Vec::new();
		file.read_to_end(&mut atom_data)
			.await
			.context("Failed to read init atom file")?;
		atoms.push(Bytes::from(atom_data));
	}
	media.read_atoms_directly(atoms)?;

	// TODO: Batch_size and batch_delay should be configured correctly for a smoother playback & no audio packet loss.
	let batch_size = 1; // Number of frame per batch.
	let target_fps = 86.0; // Should be higher than requested FPS because there will be a drop during the playback.
	let frame_delay = Duration::from_secs_f64(1.0 / target_fps);
	let batch_delay = frame_delay * batch_size as u32; // Total delay per batch

	let mut frame_index = 0;
	let start_time = Instant::now(); // Will be used for calculating the current FPS.
	let mut total_frames = 0;

	while frame_index < frame_atoms.len() {
		let mut batch = Vec::new();

		// Collect a batch of frames
		for _ in 0..batch_size {
			if frame_index + 1 < frame_atoms.len()
				&& frame_atoms[frame_index]
					.file_name()
					.unwrap()
					.to_str()
					.unwrap()
					.contains("moof")
			{
				let mut frame_pair = Vec::new();

				for offset in 0..2 {
					if frame_index + offset < frame_atoms.len() {
						let mut file = File::open(&frame_atoms[frame_index + offset])
							.await
							.context("Failed to open frame atom file")?;
						let mut atom_data = Vec::new();
						file.read_to_end(&mut atom_data)
							.await
							.context("Failed to read frame atom file")?;
						frame_pair.push(Bytes::from(atom_data));
					}
				}
				batch.push(frame_pair);
				frame_index += 2;
				total_frames += 1;
			} else {
				frame_index += 1;
				total_frames += 1;
			}
		}

		// The media should be playing from the batch at all times.
		for frame_pair in batch {
			media.read_atoms_directly(frame_pair)?;
		}

		// Logging the calculated FPS.
		let elapsed = start_time.elapsed().as_secs_f64();
		let fps = total_frames as f64 / elapsed;
		// println!("Current Elapsed: {:.2}", elapsed);
		// println!("Total Frames Sent: {:.2}", total_frames);
		// println!("Current FPS: {:.2}", fps);

		// Added delay to slow down playback speed.
		tokio::time::sleep(batch_delay).await;
	}

	Ok(())
}

// TODO: This method is saving the atoms currently, it should be configured so that we can save the atoms without playing the video itself.
// TODO: IMPORTANT: Luke sends 66.5 frame's per second, not the init frame but 66.5 (moof + mdat)'s.
async fn run_media_old(mut media: Media) -> anyhow::Result<()> {
	let mut input = tokio::io::stdin();
	let mut buf = BytesMut::new();

	loop {
		input.read_buf(&mut buf).await.context("failed to read from stdin")?;
		media.parse(&mut buf).context("failed to parse media")?;
	}
}

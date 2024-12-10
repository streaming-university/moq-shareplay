use bytes::{Bytes, BytesMut};
use std::{env, fs, net, path::PathBuf};
use url::Url;

use anyhow::Context;
use clap::Parser;
use tokio::time::{Duration, Instant};
use tokio::{fs::File, io::AsyncReadExt};

use moq_native::quic;
use moq_pub::Media;
use moq_transport::{serve, session::Publisher};

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

	// Disable tracing so we don't get a bunch of Quinn spam.
	let tracer = tracing_subscriber::FmtSubscriber::builder()
		.with_max_level(tracing::Level::WARN)
		.finish();
	tracing::subscriber::set_global_default(tracer).unwrap();

	let cli = Cli::parse();

	let (writer, _, reader) = serve::Tracks::new(cli.name).produce();
	let media = Media::new(writer)?;

	let tls = cli.tls.load()?;

	let quic = quic::Endpoint::new(moq_native::quic::Config {
		bind: cli.bind,
		tls: tls.clone(),
	})?;

	log::info!("connecting to relay: url={}", cli.url);
	let session = quic.client.connect(&cli.url).await?;

	// let (session, mut publisher) = Publisher::connect(session)
	// 	.await
	// 	.context("failed to create MoQ Transport publisher")?;

	let (session, mut publisher, subscriber) = moq_transport::session::Session::connect(session)
		.await
		.context("failed to establish forward session")?;

	// let asd = session.connect();

	tokio::select! {
		res = session.run() => res.context("session error")?,
		res = run_media(media) => res.context("media error")?,
		res = publisher.announce(reader) => res.context("publisher error")?,
		// res = subscriber.subscribe(writer) => res.context("subscriber error")?,
	}

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

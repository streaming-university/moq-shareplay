use std::time::Duration;

use anyhow::Context;
use log::{debug, trace, warn};
use moq_transport::serve::{
    DatagramsReader, GroupObjectReader, GroupReader, GroupsReader, ObjectsReader, StreamReader, TrackReader, TrackReaderMode, TrackWriter, Tracks, TracksReader, TracksWriter
};
use std::clone::Clone;
use moq_transport::session::Subscriber;
use tokio::{task::JoinSet, time::sleep};

pub struct SubToSync {
    subscriber: Subscriber,
    broadcast: TracksReader,
    tracks_writer: TracksWriter,
}

impl SubToSync {
    pub async fn new(subscriber: Subscriber, tracks: Tracks) -> anyhow::Result<Self> {
        let (tracks_writer, _tracks_request, tracks_reader) = tracks.produce();
        let broadcast = tracks_reader;

        Ok(Self {
            subscriber,
            broadcast,
            tracks_writer,
        })
    }

    pub async fn run(&mut self) -> anyhow::Result<()> {
        let sync_track_name = "sync-track";
        let mut subscriber = self.subscriber.clone();
        let mut tracks_writer = self.tracks_writer.clone();

        // Spawn a task that will repeatedly attempt to subscribe until successful
<<<<<<< HEAD
        // tokio::task::spawn(async move {
        println!("ENTERING THE LOOOPP");
        loop {
            let track = tracks_writer.create(sync_track_name).unwrap();
            println!("OH YEAH LOOPING1");

            match subscriber.subscribe_sync(track).await {
                Ok(()) => {
                    // Successfully subscribed (no additional data returned)
                    println!("OK MESSAGE CAME, QUITTING FROM LOOP");
                    break;
                }
                Err(err) => {
                    // Failed to subscribe, handle the error
                    warn!("Failed to subscribe to sync track: {err:?}, retrying in 2s");
                }
            }

            // Re-create the track handle each attempt
            sleep(Duration::from_secs(2)).await;
        }


        // });

        // Obtain the TrackReader for "sync-track"
        let sync_reader = self.broadcast.subscribe(sync_track_name)
            .context("no sync track")?;

        let mut tasks = JoinSet::new();
        tasks.spawn(async move {
            let name = sync_reader.name.clone();
            if let Err(err) = Self::recv_track(sync_reader).await {
                warn!("failed to receive sync track {name}: {err:?}");
            }
        });

        while tasks.join_next().await.is_some() {}
=======

            let mut subscriber = subscriber.clone();
            let mut tracks_writer = tracks_writer.clone();


                loop {
                    let track = tracks_writer.create(sync_track_name).unwrap();
                    match subscriber.subscribe_sync(track).await {
                        Ok(_) => {
                            // Successfully subscribed
							log::info!("Exiting the subscription now.");
                            break;
                        }
                        Err(err) => {
                            warn!("failed to subscribe to sync track: {err:?}, retrying in 2s");
                        }
                    }

                    // Re-create the track handle each attempt
                    sleep(Duration::from_secs(2)).await;
                }
		let sync_reader = self.broadcast.subscribe(sync_track_name).context("no sync track")?;
		log::info!("SYNC_READER is now available.");

		match sync_reader.mode().await.context("failed to get mode")?{
			TrackReaderMode::Stream(stream) => Self::recv_stream(stream).await?,
            TrackReaderMode::Groups(groups) => Self::recv_groups(groups).await?,
            TrackReaderMode::Objects(objects) => Self::recv_objects(objects).await?,
            TrackReaderMode::Datagrams(datagrams) => Self::recv_datagrams(datagrams).await?,
		}
>>>>>>> 03ae1b6 (We can send a message to the publisher from the client :)))
        Ok(())
    }
	async fn recv_stream(mut track: StreamReader) -> anyhow::Result<()> {
		while let Some(mut group) = track.next().await? {
			while let Some(object) = group.read_next().await? {
				let str = String::from_utf8_lossy(&object);
				println!("{}", str);
			}
		}

		Ok(())
	}

	async fn recv_groups(mut groups: GroupsReader) -> anyhow::Result<()> {
		while let Some(mut group) = groups.next().await? {
			let base = group
				.read_next()
				.await
				.context("failed to get first object")?
				.context("empty group")?;

			let base = String::from_utf8_lossy(&base);

			while let Some(object) = group.read_next().await? {
				let str = String::from_utf8_lossy(&object);
				println!("{}{}", base, str);
			}
		}

		Ok(())
	}

	async fn recv_objects(mut objects: ObjectsReader) -> anyhow::Result<()> {
		while let Some(mut object) = objects.next().await? {
			let payload = object.read_all().await?;
			let str = String::from_utf8_lossy(&payload);
			println!("{}", str);
		}

		Ok(())
	}

	async fn recv_datagrams(mut datagrams: DatagramsReader) -> anyhow::Result<()> {
		while let Some(datagram) = datagrams.read().await? {
			let str = String::from_utf8_lossy(&datagram.payload);
			println!("{}", str);
		}

		Ok(())
	}
}

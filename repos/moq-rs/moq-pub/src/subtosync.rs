use std::time::Duration;

use anyhow::Context;
use log::{debug, trace, warn};
use moq_transport::serve::{
    GroupObjectReader, GroupReader, TrackReader, TrackReaderMode, Tracks, TracksReader, TracksWriter, TrackWriter,
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
        Ok(())
    }

    async fn recv_track(track: TrackReader) -> anyhow::Result<()> {
        let name = track.name.clone();
        debug!("track {name}: start");
        if let TrackReaderMode::Groups(mut groups) = track.mode().await? {
            while let Some(group) = groups.next().await? {
                if let Err(err) = Self::recv_group(group).await {
                    warn!("failed to receive group: {err:?}");
                }
            }
        }
        debug!("track {name}: finish");
        Ok(())
    }

    async fn recv_group(mut group: GroupReader) -> anyhow::Result<()> {
        trace!("group={} start", group.group_id);
        while let Some(object) = group.next().await? {
            trace!("group={} fragment={} start", group.group_id, object.object_id);
            let buf = Self::recv_object(object).await?;
            println!("Received data on sync-track: {:?}", buf);
        }
        Ok(())
    }

    async fn recv_object(mut object: GroupObjectReader) -> anyhow::Result<Vec<u8>> {
        let mut buf = Vec::with_capacity(object.size);
        while let Some(chunk) = object.read().await? {
            buf.extend_from_slice(&chunk);
        }
        Ok(buf)
    }
}

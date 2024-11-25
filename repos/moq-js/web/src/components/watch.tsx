/* eslint-disable jsx-a11y/media-has-caption */
import { Player } from "@kixelated/moq/playback/player"

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"

import { TrackReader, type TrackChunk } from '../../../lib/transport/objects';

export default function Watch(props: { name: string }) {
	// Use query params to allow overriding environment variables.
	const urlSearchParams = new URLSearchParams(window.location.search)
	const params = Object.fromEntries(urlSearchParams.entries())
	const server = params.server ?? import.meta.env.PUBLIC_RELAY_HOST

	const [error, setError] = createSignal<Error | undefined>()

	let canvas!: HTMLCanvasElement

	const [usePlayer, setPlayer] = createSignal<Player | undefined>()
	const [showCatalog, setShowCatalog] = createSignal(false)
	const [volume, setVolume] = createSignal(50)

	let trackWriter: any // Declare trackWriter in the outer scope
	let subscriber: any

	createEffect(async () => {
		const namespace = props.name
		const url = `https://${server}`

		// Special case localhost to fetch the TLS fingerprint from the server.
		// TODO remove this when WebTransport correctly supports self-signed certificates
		const fingerprint = server.startsWith("localhost") ? `https://${server}/fingerprint` : undefined

		Player.create({ url, fingerprint, canvas, namespace }).then(setPlayer).catch(setError)

		// Get the Connection object
		const connection = usePlayer()?.getConnection();

		// Announce a new namespace
		const test_namespace = 'test-namespace'; // Use a unique namespace
		const announceSend = await connection?.announce(test_namespace);

		// Wait for the announce to be acknowledged
		await announceSend?.ok();

		// Now, wait for a subscriber to subscribe to our track
		// For testing, we'll act as the subscriber ourselves
		const trackName = 'test-track';

		// Subscribe to our own track (since we don't have an external subscriber)
		subscriber = await connection?.subscribe(test_namespace, trackName);

		// Publisher waits for a subscription
		const subscription = await connection?.subscribed();

		// Acknowledge the subscription
		await subscription?.ack();

		// Create a TrackWriter to send messages
		trackWriter = await subscription?.serve();
		
		// const quic = usePlayer()?.getConnection().getQuic()
		// const stream = await quic?.createBidirectionalStream()

		// if (!stream) {
		// 	setError(new Error("Failed to create bidirectional stream"))
		// 	return
		// }
		// const writer = new Stream.Writer(stream.writable)
		// const reader = new Stream.Reader(new Uint8Array(), stream.readable)

		// if (!quic) {
		// 	setError(new Error("Failed to get QUIC connection"))
		// 	return
		// }
		// const objects = new Objects(quic)	

		// trackWriter = await objects.send({
		// 	type: StreamType.Track, // 0x50
		// 	sub: BigInt(0),         // Subscribe ID, use appropriate value
		// 	track: BigInt(1),       // Track Alias, use appropriate value
		// 	priority: 0,            // Object Send Order
		// })
	})

	const sendMessage = async () => {
		const testMessage = 'Hello, this is a test message';
		const payload = new TextEncoder().encode(testMessage);

		// Send the message as a TrackChunk
		await trackWriter.write({
		group: 0,
		object: 0,
		payload: payload,
		});

		// Close the track when done
		await trackWriter.close();

		// On the subscriber side, receive the message
		const reader = await subscriber.data();
		if (reader instanceof TrackReader) {
			let chunk: TrackChunk | undefined;
			while ((chunk = await reader.read())) {
				if (chunk.payload instanceof Uint8Array) {
				const message = new TextDecoder().decode(chunk.payload);
				console.log(`Received message: ${message}`);
				}
			}
		}
	}

	// const sendMessage = async () => {
	// 	const objectsToSend = [
	// 		{
	// 		  group: 0,
	// 		  object: 0,
	// 		  payload: new TextEncoder().encode('hello world'),
	// 		},
	// 		{
	// 		  group: 0,
	// 		  object: 1,
	// 		  payload: new TextEncoder().encode('this is a second message'),
	// 		},
	// 		{
	// 		  group: 0,
	// 		  object: 2,
	// 		  payload: new TextEncoder().encode('and a third one'),
	// 		},
	// 		// Add more objects as needed
	// 	  ];
		
	// 	await trackWriter.write({
	// 		group: 0,
	// 		object: 0,
	// }	);
		
	// 	  // Write each object to the stream
	// 	//   for (const obj of objectsToSend) {
	// 	// 	await trackWriter.write(obj);
	// 	//   }
	// }

	const changeVolume = (event: Event) => {
		const volumeValue = (event.target as HTMLInputElement).value
		setVolume(Number(volumeValue)) // Update the signal
		usePlayer()?.setVolume(Number(volumeValue) / 100) // Adjust the player's volume
	}

	createEffect(() => {
		const player = usePlayer()
		if (!player) return

		onCleanup(() => player.close())
		player.closed().then(setError).catch(setError)
	})

	const play = () => {
		usePlayer()?.play().catch(setError)
	}

	const pause = () => {
		usePlayer()?.pause().catch(setError);
	};

	const handleContinue = () => {
		usePlayer()?.resubscribe().catch(setError);
	};

	// The JSON catalog for debugging.
	const catalog = createMemo(() => {
		const player = usePlayer()
		if (!player) return

		const catalog = player.getCatalog()
		return JSON.stringify(catalog, null, 2)
	})

	// NOTE: The canvas automatically has width/height set to the decoded video size.
	// TODO shrink it if needed via CSS
	return (
		<>
		  <canvas ref={canvas} onClick={play} />

		  <div class="volume-control">
			<label>Volume</label>
			<input
			  id="volume"
			  type="range"
			  min="0"
			  max="100"
			  value={volume()}
			  onInput={changeVolume}
			/>
		  </div>

		  <div class="controls">
			<button class="controls-button" onClick={pause}>Pause</button>
		  </div>

		  <div class="controls">
			<button class="controls-button" onClick={handleContinue}>Continue</button>
		  </div>

		  <div class="controls">
			<button class="controls-button" onClick={sendMessage}>sendMessage</button>
		  </div>
		</>
	  )
}

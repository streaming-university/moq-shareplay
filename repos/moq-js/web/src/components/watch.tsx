/* eslint-disable jsx-a11y/media-has-caption */
import { Player } from "@kixelated/moq/playback/player"

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"

import { TrackReader, TrackWriter, type TrackChunk } from '../../../lib/transport/objects'
import { SubscribeSend } from '../../../lib/transport/subscriber'

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
	const [reader, setReader] = createSignal<TrackReader | undefined>()

	let sendMessageLock = Promise.resolve() // Initially resolved

	// ----------- variables for sync functionality ------------
	const trackName = 'sync-track'
	const test_namespace = 'sync-namespace'
	let trackWriter!: TrackWriter
	let subscriber!: SubscribeSend
	let objectNumber = 0
	let groupNumber = 0
	// ---------------------------------------------------------

	createEffect(async () => {
		const namespace = props.name
		const url = `https://${server}`

		// Special case localhost to fetch the TLS fingerprint from the server.
		// TODO remove this when WebTransport correctly supports self-signed certificates
		const fingerprint = server.startsWith("localhost") ? `https://${server}/fingerprint` : undefined

		Player.create({ url, fingerprint, canvas, namespace }).then(setPlayer).catch(setError)
		
		// Get the Connection object
		const connection = usePlayer()?.getConnection()

		// Announce a new namespace
		const announceSend = await connection?.announce(test_namespace)

		// Wait for the announce to be acknowledged
		await announceSend?.ok()

		// Subscribe to our own track (since we don't have an external subscriber)
		const sub = await connection?.subscribe(test_namespace, trackName)
		if (!sub) {
			console.error("Failed to subscribe")
			return
		}
		subscriber = sub

		// Publisher waits for a subscription
		const subscription = await connection?.subscribed()

		// Acknowledge the subscription
		await subscription?.ack()

		// Create a TrackWriter to send messages
		const writer = await subscription?.serve()
		if (!writer) {
			console.error("Failed to subscribe")
			return
		}
		trackWriter = writer
		
		syncTrackListener()
	})
	
	const syncTrackListener = async () => {
	  if (!subscriber) {
		console.error("Subscriber not ready")
		return
	  }
	
	  const reader = await subscriber.data()
	  if (reader instanceof TrackReader) {
		let chunk: TrackChunk | undefined
		try {
		  while ((chunk = await reader.read())) {
			if (chunk.payload instanceof Uint8Array) {
			  const message = new TextDecoder().decode(chunk.payload)
			  console.log(`Received message: ${message}`)
			}
		  }
		} catch (err) {
		  console.error("Error reading chunk:", err)
		}
	  }
	}

	const sendMessage = async () => {
		const testMessage = 'Hello, this is a test message'
		const payload = new TextEncoder().encode(testMessage)

		// Send the message as a TrackChunk
		await trackWriter.write({
			group: groupNumber,
			object: objectNumber++,
			payload: payload,
		})

		console.log("Message sent successfully")
	}

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
		usePlayer()?.pause().catch(setError)
	}

	const handleContinue = () => {
		usePlayer()?.resubscribe().catch(setError)
	}

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

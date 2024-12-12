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
	
	let clientId = -1 // Default to invalid ID
	if (urlSearchParams.has("master")) {
		clientId = 0 // Master gets ID 0
		console.log("Client is master with ID:", clientId)
	} else {
		for (const [key] of urlSearchParams.entries()) {
			if (key.startsWith("slave")) {
				const slaveId = parseInt(key.replace("slave", ""), 10)

				if (slaveId > 0) { // Accept only slave IDs > 0
					clientId = slaveId
					console.log(`Client is slave with ID: ${clientId}`)
				} else {
					console.error("Invalid slave ID (must be slave1, slave2, ... and slave0 is not allowed)")
				}
				break
			}
		}
	}

	if (clientId === -1) {
		console.error("No valid master or slave role specified in the URL")
	}

	// ----------- variables for sync functionality ------------
	const syncTrackName = 'sync-track'
	const syncNamespace = 'sync-namespace'
	let trackWriter!: TrackWriter
	let subscriber!: SubscribeSend
	let objectNumber = clientId === 0 ? 0 : 100
	let groupNumber = clientId === 0 ? 0 : 1
	// ---------------------------------------------------------

	createEffect(async () => {
		const namespace = props.name
		const url = `https://${server}`

		// Special case localhost to fetch the TLS fingerprint from the server.
		// TODO remove this when WebTransport correctly supports self-signed certificates
		const fingerprint = server.startsWith("localhost") ? `https://${server}/fingerprint` : undefined

		Player.create({ url, fingerprint, canvas, namespace }).then(setPlayer).catch(setError)
	})

	createEffect(() => {
		const player = usePlayer()
		if (!player) return

		onCleanup(() => player.close())
		player.closed().then(setError).catch(setError)
	})

	const createTrackWriter = async () => {

		try{
			const connection = usePlayer()?.getConnection()
			console.warn("1")
			// Publisher waits for a subscription
			const subscription = await connection?.subscribed()
			console.warn("2")
			// Acknowledge the subscription
			await subscription?.ack()
			console.warn("3")
			// Create a TrackWriter to send messages
			const writer = await subscription?.serve()
			console.warn("4")
			if (!writer) {
				console.error("Failed to subscribe AAAAAAAAAAA")
				return
			}
			console.warn("5")
			trackWriter = writer
			console.warn("6")
			console.log("TrackWriter successfully created!")

		}catch(err){
			if (err instanceof Error && err.message.includes("not yet locked to a reader")) {
				console.warn(`TrackWriter already created for sending messages.`);
			} else {
				console.error("Error creating TrackWriter: ", err);
			}
		}
		console.warn("7")
	}

	const announceSyncNamespace = async () => {
		if (clientId !== 0) {
			// console.error("Only the master can announce a sync track")
			return
		}

		try{	
			// Get the Connection object
			const connection = usePlayer()?.getConnection()
	
			// Announce a new namespace
			const announceSend = await connection?.announce(syncNamespace)
	
			// Wait for the announce to be acknowledged
			await announceSend?.ok()

			console.log(`Sync namespace (${syncNamespace}) successfully announced!`)

		}catch(err){
			if (err instanceof Error && err.message.includes("already announce: sync-namespace")) {
				console.warn(`Sync namespace (${syncNamespace}) already announced`);
			} else {
				console.error("Error announcing sync namespace:", err);
			}
		}
		
	}

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

	const subscirbeToSyncTrack = async () => {
		// Get the Connection object
		const connection = usePlayer()?.getConnection()

		// Subscribe to our own track (since we don't have an external subscriber)
		const sub = await connection?.subscribe(syncNamespace, syncTrackName)
		if (!sub) {
			console.error("Failed to subscribe")
			return
		}
		subscriber = sub

		syncTrackListener()
	}

	const sendMessage = async () => {
		const sender = clientId === 0 ? "Master" : `Slave ${clientId}`
		const testMessage = `Hello, this message is sent by ${sender}!`
		const payload = new TextEncoder().encode(testMessage)

		try{
			// Send the message as a TrackChunk
			await trackWriter.write({
				group: groupNumber,
				object: objectNumber++,
				payload: payload,
			})
		}catch(err){
			console.error("Error sending message: ", err)
		}
		

		console.log("Message sent successfully")
	}

	const runClient = async () => {
		try{
			if(clientId === 0) {
				await announceSyncNamespace()
				await createTrackWriter()
				await subscirbeToSyncTrack()	
			}else{
				await subscirbeToSyncTrack()
			}
			
		}catch(err){
			console.error("SSSSSSSSSSSSSSSSSS")
		}
		
	}

	const changeVolume = (event: Event) => {
		const volumeValue = (event.target as HTMLInputElement).value
		setVolume(Number(volumeValue)) // Update the signal
		usePlayer()?.setVolume(Number(volumeValue) / 100) // Adjust the player's volume
	}

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
				<button class="controls-button" onClick={runClient}>Subscribe to Sync Track</button>
			</div>

			<div class="controls">
				<button class="controls-button" onClick={sendMessage}>Send Message</button>
			</div>
		</>
	)
}

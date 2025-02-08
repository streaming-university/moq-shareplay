/* eslint-disable jsx-a11y/media-has-caption */
import { Player } from "@kixelated/moq/playback/player"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { TrackReader, TrackWriter, type TrackChunk } from '../../../lib/transport/objects'
import { SubscribeSend } from '../../../lib/transport/subscriber'
import './watch.css'

export default function Watch(props: { name: string }) {
	// Use query params to allow overriding environment variables.
	const urlSearchParams = new URLSearchParams(window.location.search)
	const params = Object.fromEntries(urlSearchParams.entries())
	const server = params.server ?? import.meta.env.PUBLIC_RELAY_HOST

	const [error, setError] = createSignal<Error | undefined>()

	let canvas!: HTMLCanvasElement

	const [usePlayer, setPlayer] = createSignal<Player | undefined>()
	const [showCatalog, setShowCatalog] = createSignal(false)
	const [isPaused, setIsPaused] = createSignal(false)
	const [isAnnounced, setIsAnnounced] = createSignal(false)
	const [isTrackWriterCreated, setIsTrackWriterCreated] = createSignal(false)
	const [isSubscribed, setIsSubscribed] = createSignal(false)
	const [volume, setVolume] = createSignal(50)
	const [reader, setReader] = createSignal<TrackReader | undefined>()
	const [messageInput, setMessageInput] = createSignal("")
	let clientId = -1 // Default to invalid ID
	const [sliderValue, setSliderValue] = createSignal(0)
	const [hoverValue, setHoverValue] = createSignal(0)
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
	let objectNumber = 0//clientId === 0 ? 0 : 100
	let groupNumber = 0//clientId === 0 ? 0 : 1
	// ---------------------------------------------------------

	createEffect(async () => {
		const namespace = props.name
		const url = `https://${server}`

		const initialVolume = 50; // Set your desired initial volume (0–100)
		const slider = document.querySelector(".volume-control input[type='range']") as HTMLInputElement;

		if (slider) {
			slider.value = `${initialVolume}`; // Set slider value
			slider.style.setProperty("--volume-percent", `${initialVolume}%`); // Set initial CSS variable
			setVolume(initialVolume); // Update state
			usePlayer()?.setVolume(initialVolume / 100); // Set player volume
		}

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
		if(isTrackWriterCreated()){
			return
		}

		try {
			const connection = usePlayer()?.getConnection()

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

			console.log("TrackWriter successfully created!")

		} catch (err) {
			if (err instanceof Error && err.message.includes("not yet locked to a reader")) {
				console.warn(`TrackWriter already created for sending messages.`);
			} else {
				console.error("Error creating TrackWriter: ", err);
			}
		}
		setIsTrackWriterCreated(true)

	}

	const announceSyncNamespace = async () => {
		if (clientId !== 0) {
			// console.error("Only the master can announce a sync track")
			return
		}
		if(isAnnounced()){
			return
		}

		try {
			// Get the Connection object
			const connection = usePlayer()?.getConnection()

			// Announce a new namespace
			const announceSend = await connection?.announce(syncNamespace)

			// Wait for the announce to be acknowledged
			await announceSend?.ok()

			console.log(`Sync namespace (${syncNamespace}) successfully announced!`)

		} catch (err) {
			if (err instanceof Error && err.message.includes("already announce: sync-namespace")) {
				console.warn(`Sync namespace (${syncNamespace}) already announced`);
			} else {
				console.error("Error announcing sync namespace:", err);
			}
		}
		setIsAnnounced(true)

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

						if (message === "play" && clientId !== 0) {
							handleContinue();
						} else if (message === "pause" && clientId !== 0) {
							pause();
						}

						const chatMessages = document.querySelector(".chat-messages")
						const messageElement = document.createElement("div")
						if (!isNaN(Number(message))) {
							messageElement.textContent = `[Master via Sync-track] : Go to ${message}th fragment`
						} else {
							messageElement.textContent = `[Master via Sync-track] : ${message}`
						}
						chatMessages?.appendChild(messageElement)
					}
				}
			} catch (err) {
				console.error("Error reading chunk:", err)
			}
		}
	}

	const subscribeToSyncTrack = async () => {
		if(isSubscribed()){
			return
		}

		// Get the Connection object
		const connection = usePlayer()?.getConnection()

		// Subscribe to our own track (since we don't have an external subscriber)
		const sub = await connection?.subscribe(syncNamespace, syncTrackName)


		if (!sub) {
			console.error("Failed to subscribe")
			return
		}
		subscriber = sub
		setIsSubscribed(true)
		syncTrackListener()

	}

	const sendFrameMessage = async (frame: string) => {

		const payload = new TextEncoder().encode(frame)

		try {
			// Send the message as a TrackChunk
			await trackWriter.write({
				group: groupNumber++,
				object: objectNumber++,
				payload: payload,
			})

			console.log("Chat message sent successfully")
		} catch (err) {
			console.error("Error sending message: ", err)
		}

		// Clear the input field after sending
		setMessageInput("")
	}
	const sendMessage = async () => {
		const sender = clientId === 0 ? "Master" : `Slave-${clientId}`
		const customMessage = messageInput() // Get message from textbox

		const payload = new TextEncoder().encode(customMessage)

		try {
			// Send the message as a TrackChunk
			await trackWriter.write({
				group: groupNumber++,
				object: objectNumber++,
				payload: payload,
			})

			console.log("Chat message sent successfully")
		} catch (err) {
			console.error("Error sending message: ", err)
		}

		// Clear the input field after sending
		setMessageInput("")
	}

	const sendSyncMessage = async (action: string) => {
		let payload = new TextEncoder().encode(action)

		try {
			// Send the message as a TrackChunk
			await trackWriter.write({
				group: groupNumber++,
				object: objectNumber++,
				payload: payload,
			})
			console.log("Sync message sent successfully")
		} catch (err) {
			console.error("Error sending message: ", err)
		}

		payload = new TextEncoder().encode(action)
		try {
			// Send the message as a TrackChunk
			await trackWriter.write({
				group: groupNumber++,
				object: objectNumber++,
				payload: payload,
			})
			console.log("Sync message sent successfully")
		} catch (err) {
			console.error("Error sending message: ", err)
		}
	}

	const runClient = async () => {
		try {
			if (clientId === 0) {
				await announceSyncNamespace()
				await createTrackWriter()
			}
			await subscribeToSyncTrack()

		} catch (err) {
			console.error("Error running client: ", err)
		}
	}

	const changeVolume = (event: Event) => {
		const volumeValue = (event.target as HTMLInputElement).value
		setVolume(Number(volumeValue))
		usePlayer()?.setVolume(Number(volumeValue) / 100)

		const slider = event.target as HTMLInputElement
		slider.style.setProperty('--volume-percent', `${volumeValue}%`)
	}

	const play = () => {
		setIsPaused(false);
		usePlayer()?.play().catch(setError)
	}

	const pause = () => {
		usePlayer()?.pause().catch(setError);
		setIsPaused(true);
	}

	const handleContinue = () => {
		setIsPaused(false);
		usePlayer()?.resubscribe().catch(setError)
	}

	const sendTrackStatusRequest = () => { //Trial
		usePlayer()?.getConnection()?.sendTrackStatusRequest(syncNamespace, syncTrackName)
	}

	// The JSON catalog for debugging.
	const catalog = createMemo(() => {
		const player = usePlayer()
		if (!player) return

		const catalog = player.getCatalog()
		return JSON.stringify(catalog, null, 2)
	})

	const formatTime = (seconds: number) => {
		const minutes = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${minutes}:${secs.toString().padStart(2, '0')}`;
	};

	// NOTE: The canvas automatically has width/height set to the decoded video size.
	// TODO shrink it if needed via CSS
	return (
		<>
		  <div class="youtube-layout">
			<div class="video-section">
			  <div class="video-container">
				<canvas ref={canvas} onClick={() => setIsPaused(!isPaused())} />
				<div class="slider-overlay">
				  <div class="slider-wrap">
					<input
					  id="time-slider"
					  type="range"
					  min="0"
					  max="540"
					  onInput={(e) => {
						setSliderValue(hoverValue)
						sendFrameMessage(String(hoverValue() * 60));
					  }}
					  onMouseMove={(e) => {
						const slider = e.currentTarget as HTMLInputElement;
						const rect = slider.getBoundingClientRect();
						const offsetX = e.clientX - rect.left;
						const percent = offsetX / rect.width;

						const minValue = parseFloat(slider.min);
						const maxValue = parseFloat(slider.max);
						const stepSize = parseFloat(slider.step) || 1;

						let newSecond = minValue + percent * (maxValue - minValue);
						const snappedValue = Math.round(newSecond / stepSize) * stepSize;
						const boundedValue = Math.max(minValue, Math.min(snappedValue, maxValue));


						setHoverValue(boundedValue);
					}}

					/>
					<div class="tooltip" style={{ left: `${(hoverValue() / 540) * 100}%` }}>{formatTime(hoverValue())}</div>

				  </div>
				</div>
			  </div>

			  {/* Keep the rest of your controls here */}
			  <div class="video-info">
				<div class="video-controls">
				  {/* PLAY/PAUSE */}
				  <div class="control-group">
					<button
					  class="controls-button play-pause-button"
					  onClick={() => {
						if (isPaused()) {
						  sendSyncMessage("play")
						  handleContinue()
						} else {
						  sendSyncMessage("pause")
						  pause()
						}
					  }}
					  disabled={clientId !== 0}
					>
					  {isPaused() ? "⏵" : "⏸"}
					</button>
				  </div>

				  {/* VOLUME */}
				  <div class="control-group volume-control">
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

				  {/* SYNC + Quick Buttons */}
				  <div class="control-group">
					<button
					  class="controls-button"
					  onClick={runClient}
					>
					  {clientId === 0 ? "Announce Sync" : "Subscribe Sync"}
					</button>
					<button
					  class="controls-button"
					  onClick={() => sendFrameMessage("0")}
					  disabled={clientId !== 0}
					>
					  00:00
					</button>
					<button
					  class="controls-button"
					  onClick={() => sendFrameMessage("10000")}
					  disabled={clientId !== 0}
					>
					  01:14
					</button>
					<button
					  class="controls-button"
					  onClick={() => sendFrameMessage("20000")}
					  disabled={clientId !== 0}
					>
					  02:29
					</button>
				  </div>
				</div>
			  </div>
			</div>

			{/* CHAT SECTION */}
			<div class="chat-section">
			  <div class="chat-header">Live Media over QUIC Chat</div>
			  <div class="chat-messages">
				{/* Messages will appear here */}
			  </div>
			  <div class="message-input-container">
				{clientId === 0 && (
				  <input
					type="text"
					class="message-input"
					placeholder="Send a message..."
					value={messageInput()}
					onInput={(e) => setMessageInput(e.currentTarget.value)}
				  />
				)}
				{clientId === 0 && (
				  <button class="send-button" onClick={sendMessage}>
					Send
				  </button>
				)}
			  </div>
			</div>
		  </div>
		</>
	  )
}

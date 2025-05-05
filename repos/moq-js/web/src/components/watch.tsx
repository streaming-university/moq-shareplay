/* eslint-disable jsx-a11y/media-has-caption */
import { Player } from "@kixelated/moq/playback/player"
import { createEffect, createMemo, createSignal, onCleanup, Show, For } from "solid-js"
import { TrackReader, TrackWriter, type TrackChunk } from "../../../lib/transport/objects"
import { SubscribeSend } from "../../../lib/transport/subscriber"
import "./watch.css"
import "./menu.css"
export default function Watch() {
	// Use query params to allow overriding environment variables.
	const urlSearchParams = new URLSearchParams(window.location.search)
	const params = Object.fromEntries(urlSearchParams.entries())
	const server = params.server ?? import.meta.env.PUBLIC_RELAY_HOST

	const [error, setError] = createSignal<Error | undefined>()

	let canvas!: HTMLCanvasElement

	const [usePlayer, setPlayer] = createSignal<Player | undefined>()
	const [showCatalog, setShowCatalog] = createSignal(false)
	const [isPaused, setIsPaused] = createSignal(false)
	const [showChat, setShowChat] = createSignal(true)
	const [isAnnounced, setIsAnnounced] = createSignal(false)
	const [isTrackWriterCreated, setIsTrackWriterCreated] = createSignal(false)
	const [isSubscribed, setIsSubscribed] = createSignal(false)
	const [volume, setVolume] = createSignal(50)
	const [reader, setReader] = createSignal<TrackReader | undefined>()
	const [messageInput, setMessageInput] = createSignal("")

	const [sliderValue, setSliderValue] = createSignal(0)
	const [hoverValue, setHoverValue] = createSignal(0)

	let clientId = -1 // Default to invalid ID
	let role: "leader" | "follower" | null = null
	const roomName = params.room ?? null // e.g. ?room=room1

	// State for selected room and role
	const [selectedRoom, setSelectedRoom] = createSignal<number | null>(null)
	const [selectedRole, setSelectedRole] = createSignal<string | null>(null)
	const [roomStatuses, setRoomStatuses] = createSignal<Record<string, { leaderPresent: boolean, clientCount: number }>>({});

	let socket: WebSocket | undefined
	// Handle Join function to construct the URL dynamically
	const handleJoin = () => {
		if (!selectedRoom() || !selectedRole()) {
			alert("Please select both a room and a role.")
			return
		}
		const newUrl = new URL(window.location.href)
		newUrl.searchParams.set("room", `room${selectedRoom()}`)
		newUrl.searchParams.set("role", selectedRole()!)
		window.location.href = newUrl.toString()
		// socket = new WebSocket("ws://localhost:8080");
	}

	if (!params.room && !params.role) {
		createEffect(() => {
			if (!socket) {
				//const ws_url = new URLSearchParams(location.search).get('ws_server');
				// let endpoint = "wss://shareplay.streaming.university/ws/";
				let endpoint = "ws://localhost:8005";
				console.log(endpoint)
				socket = new WebSocket(endpoint);

				socket.onopen = () => {
					console.log("[WS] Menu socket connected");

					socket?.send(JSON.stringify({
						type: "status-request"
					}));

					// Then send a status request every 500ms
					const interval = setInterval(() => {
						socket?.send(JSON.stringify({ type: "status-request" }));
					}, 500);

					onCleanup(() => {
						clearInterval(interval);
					});
				};

				socket.onmessage = (e) => {
					try {
						const msg = JSON.parse(e.data);
						if (msg.type === "status-response") {
							setRoomStatuses(msg.rooms);
						}
					} catch (err) {
						console.error("Failed to parse menu socket message:", e);
					}
				};

				socket.onerror = (e) => {
					console.error("[WS] Menu socket error:", e);
				};

				socket.onclose = () => {
					console.warn("[WS] Menu socket closed");
				};
			}
		});
		return (
			<div class="main-menu">
				<div class="title-container">
					<h1 class="fancy-title">Select Room & Role</h1>
				</div>
				<div class="selection-container">
					{/* Room Selection */}
					<div class="room-selection">
						<h2>ROOM</h2>
						<div class="room-grid">
							<For each={[1, 2, 3, 4, 5]}>
								{(roomNum) => {
									const roomName = `room${roomNum}`;
									return (
										<div style="display: flex; flex-direction: column; align-items: center;">
											<button
												class={`room-button ${selectedRoom() === roomNum ? "selected" : ""}`}
												onClick={() => setSelectedRoom(roomNum)}
											>
												Room {roomNum}
											</button>
											<Show when={roomStatuses()[roomName]}>
												{(roomInfo) => (
													<div style="margin-top: 6px; text-align: center; font-size: 0.9rem; color: #ccc;">
														{roomInfo().clientCount} user{roomInfo().clientCount !== 1 ? "s" : ""}<br />
														Leader: {roomInfo().leaderPresent ? "✓" : "✖️"}
													</div>
												)}
											</Show>
										</div>
									);
								}}
							</For>
						</div>
					</div>

					{/* Role Selection */}
					<div class="role-selection">
						<h2>ROLE</h2>
						<div class="role-grid">
							<For each={["leader", "follower"]}>
								{(role) => {
									const isLeaderDisabled = role === "leader" && !!selectedRoom() && !!roomStatuses()[`room${selectedRoom()}`]?.leaderPresent;
									return (
										<button
											class={`role-button ${selectedRole() === role ? "selected" : ""} ${isLeaderDisabled ? "disabled" : ""}`}
											onClick={() => {
												if (!isLeaderDisabled) setSelectedRole(role);
											}}
											disabled={isLeaderDisabled}
										>
											{role.charAt(0).toUpperCase() + role.slice(1)}
										</button>
									);
								}}
							</For>
						</div>
						<Show when={
							selectedRoom() &&
							selectedRole() === "leader" &&
							roomStatuses()[`room${selectedRoom()}`]?.leaderPresent
						}>
							<div style="color: #ff4d4f; margin-top: 10px; text-align: center; font-size: 0.9rem;">
								⚠️ Only 1 Leader is allowed per room.
							</div>
						</Show>
					</div>
				</div>

				{/* Join Button */}
				<button
					class="join-button"
					onClick={handleJoin}
					disabled={
						!selectedRoom() ||
						!selectedRole() ||
						(selectedRole() === "leader" && roomStatuses()[`room${selectedRoom()}`]?.leaderPresent)
					}
				>
					Join
				</button>
			</div>
		)
	}

	if (params.role === "leader") {
		role = "leader"
		clientId = 0 // Leader gets ID 0
		console.log(`Client is LEADER in room: ${roomName}, ID: ${clientId}`)
	} else if (params.role?.startsWith("follower")) {
		const followerId = parseInt(params.role.replace("follower", ""), 10)

		if (followerId > 0) {
			role = "follower"
			clientId = followerId
			console.log(`Client is FOLLOWER in room: ${roomName}, ID: ${clientId}`)
		} else {
			// console.error("Invalid follower ID (must be follower1, follower2, ... and follower0 is not allowed)")
		}
	}

	// ----------- variables for sync functionality ------------x
	const syncTrackName = "sync-track"
	let syncNamespace = `sync-namespace-${roomName}`
	let trackWriter!: TrackWriter
	let subscriber!: SubscribeSend
	let objectNumber = 0 //clientId === 0 ? 0 : 100
	let groupNumber = 0 //clientId === 0 ? 0 : 1
	// ---------------------------------------------------------

	createEffect(() => {
		if (!socket && params.room && params.role) {
			//const ws_url = new URLSearchParams(location.search).get('ws_server');
			// let endpoint = "wss://shareplay.streaming.university/ws/";
			let endpoint = "ws://localhost:8005";
			console.log(`2: Connecting to ${endpoint}`);
			// socket = new WebSocket(endpoint);
			socket = new WebSocket(endpoint);

			socket.onopen = () => {
				console.log(`[WS] connected ${params.room}, ${params.role}`);

				// Send connection info once on connect
				if (socket?.readyState === WebSocket.OPEN) {
					socket.send(
						JSON.stringify({
							type: "connect",
							room: params.room,
							role: params.role,
							id: clientId,
							namespace: syncNamespace,
						})
					);
				}

				// Handle disconnect (on refresh/close/tab close)
				const handleUnload = (event: BeforeUnloadEvent) => {
					if (socket?.readyState === WebSocket.OPEN) {
						socket.send(
							JSON.stringify({
								type: "disconnect",
								reason: "unload",
								room: params.room,
								role: params.role,
								id: clientId,
							})
						);
					}
				};

				window.addEventListener("beforeunload", handleUnload);

				setInterval(() => {
					socket?.send(JSON.stringify({ type: "status-request" }));
				}, 1000);

				onCleanup(() => {
					window.removeEventListener("beforeunload", handleUnload);
				});
			};

			socket.onmessage = (e) => {
				console.log("[WS] message:", e.data);

				// Handle namespace update message
				try {
					const msg = JSON.parse(e.data);
					if (msg.type === "namespace-update") {
						console.log(`[WS] Updating namespace to ${msg.newNamespace}`);
						syncNamespace = msg.newNamespace;
						if (clientId !== 0) {
							runFollower()
						}
						else {
							runLeader()
						}
					}
				} catch (err) {
					console.warn("[WS] Failed to parse message:", e.data);
					console.error("[WS] JSON parse error:", err); // Add this!
				}
			};

			socket.onerror = (e) => {
				console.error("[WS] error:", e);
			};

			socket.onclose = () => {
				console.warn("[WS] closed");
			};
		}
	});





	createEffect(async () => {
		const url = `https://${server}`

		const initialVolume = 0 // Set your desired initial volume (0–100)
		const slider = document.querySelector(".volume-control input[type='range']") as HTMLInputElement

		if (slider) {
			slider.value = `${initialVolume}` // Set slider value
			slider.style.setProperty("--volume-percent", `${initialVolume}%`) // Set initial CSS variable
			usePlayer()?.setMuted(true)
			setVolume(initialVolume) // Update state
			usePlayer()?.setVolume(initialVolume / 100)
		}

		// Special case localhost to fetch the TLS fingerprint from the server.
		// TODO remove this when WebTransport correctly supports self-signed certificates
		const fingerprint = server.startsWith("localhost") ? `https://${server}/fingerprint` : undefined

		Player.create({ url, fingerprint, canvas, namespace: roomName })
			.then((player) => {
				setPlayer(player)

				player.setMessageCallback((msg) => {
					const value = Math.min(msg.playbackTime, 540)
					const slider = document.getElementById("time-slider") as HTMLInputElement
					slider.value = value.toString()
					setSliderValue(value)
				})
			})
			.catch(setError)

		if (clientId !== 0) {
			runFollower()
		}
	})

	createEffect(() => {
		const player = usePlayer()
		if (!player) return

		onCleanup(() => player.close())
		player.closed().then(setError).catch(setError)
	})

	createEffect(() => {
		if (clientId === 0) {
			document.body.classList.remove("follower-theme")
			document.body.classList.add("leader-theme")
		} else {
			document.body.classList.remove("leader-theme")
			document.body.classList.add("follower-theme")
		}
	})

	const createTrackWriter = async () => {

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
				console.warn(`TrackWriter already created for sending messages.`)
			} else {
				console.error("Error creating TrackWriter: ", err)
			}
		}
		setIsTrackWriterCreated(true)
	}

	const announceSyncNamespace = async () => {
		if (clientId !== 0) {
			// console.error("Only the leader can announce a sync track")
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
				console.warn(`Sync namespace (${syncNamespace}) already announced`)
			} else {
				console.error("Error announcing sync namespace:", err)
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
							handleContinue()
						} else if (message === "pause" && clientId !== 0) {
							pause()
						}

						const chatMessages = document.querySelector(".chat-messages")
						const messageElement = document.createElement("div")
						if (!isNaN(Number(message))) {
							messageElement.textContent = `[Leader via Sync-track] : Go to ${message}th fragment`
						} else {
							messageElement.textContent = `[Leader via Sync-track] : ${message}`
						}
						chatMessages?.appendChild(messageElement)
						if (chatMessages) {
							chatMessages.scrollTop = chatMessages.scrollHeight
						}
					}
				}
			} catch (err) {
				console.error("Error reading chunk:", err)
			}
		}
	}

	const subscribeToSyncTrack = async () => {

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
		const sender = clientId === 0 ? "Leader" : `Follower-${clientId}`
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
		const payload = new TextEncoder().encode(action)

		try {
			// Send the message as a TrackChunk
			await trackWriter.write({
				group: groupNumber++,
				object: objectNumber++,
				payload: payload,
			})
			console.log("Sync message sent successfully")
			if (isPaused()) {
				setIsPaused(false)
			} else {
				setIsPaused(true)
			}
		} catch (err) {
			console.error("Error sending message: ", err)
		}
	}

	const runLeader = async () => {
		try {
			await announceSyncNamespace()
			await createTrackWriter()
			await subscribeToSyncTrack()
		} catch (err) {
			console.error("Error running client: ", err)
		}
	}

	const runFollower = async () => {
		try {
			await subscribeToSyncTrack()
		} catch (err) {
			console.error("Error running client: ", err)
		}
	}

	const changeVolume = (event: Event) => {
		const volumeValue = Number((event.target as HTMLInputElement).value)
		setVolume(volumeValue)

		const player = usePlayer()
		if (player) {
			if (player.isMuted() && volumeValue > 0) {
				console.log("User interaction is here, volume will be setting now.")
				player.setMuted(false) // Unmute when user interacts
				player.play()
			}
			player.setVolume(volumeValue / 100)
		}

		const slider = event.target as HTMLInputElement
		slider.style.setProperty("--volume-percent", `${volumeValue}%`)
	}

	const play = () => {
		setIsPaused(false)
		usePlayer()?.play().catch(setError)
	}

	const pause = () => {
		usePlayer()?.pause().catch(setError)
		setIsPaused(true)
	}

	const handleContinue = () => {
		setIsPaused(false)
		usePlayer()?.resubscribe().catch(setError)
	}

	const sendTrackStatusRequest = () => {
		//Trial
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
		const minutes = Math.floor(seconds / 60)
		const secs = seconds % 60
		return `${minutes}:${secs.toString().padStart(2, "0")}`
	}

	const goToMainMenu = () => {
		const newUrl = new URL("https://moq.streaming.university/?server=shareplay.streaming.university%3A4444")
		// newUrl.pathname = "/"
		// newUrl.search = ""
		console.log(`Redirecting user to: ${newUrl.toString()}`)
		window.location.href = newUrl.toString()
	}

	// NOTE: The canvas automatically has width/height set to the decoded video size.
	// TODO shrink it if needed via CSS
	return (
		<>
			<div class="youtube-layout">
				<div class="video-section">
					<div class="video-container">
						<canvas ref={canvas} />
						<div class="slider-overlay">
							{clientId === 0 && (
								<div class="slider-wrap">
									<input
										id="time-slider"
										type="range"
										min="0"
										max="540"
										onInput={(e) => {
											setSliderValue(hoverValue)
											sendFrameMessage(hoverValue().toString())
										}}
										onMouseMove={(e) => {
											const slider = e.currentTarget as HTMLInputElement
											const rect = slider.getBoundingClientRect()
											const offsetX = e.clientX - rect.left
											const percent = offsetX / rect.width

											const minValue = parseFloat(slider.min)
											const maxValue = parseFloat(slider.max)
											const stepSize = parseFloat(slider.step) || 1

											const newSecond = minValue + percent * (maxValue - minValue)
											const snappedValue = Math.round(newSecond / stepSize) * stepSize
											const boundedValue = Math.max(minValue, Math.min(snappedValue, maxValue))

											setHoverValue(boundedValue)
										}}
										style={{
											background: `linear-gradient(to right, #f00 0%, #f00 ${(sliderValue() / 540) * 100
												}%, #ccc ${(sliderValue() / 540) * 100}%, #ccc 100%)`,
										}}
									/>
									<div class="tooltip" style={{ left: `${(hoverValue() / 540) * 100}%` }}>
										{formatTime(hoverValue())}
									</div>
								</div>
							)}
						</div>
					</div>

					<div class="video-info">
						<div class="video-controls">
							{/* PLAY/PAUSE */}
							<div class="control-group">
								<button
									class="controls-button play-pause-button"
									onClick={() => {
										if (isPaused()) {
											sendSyncMessage("play")
										} else {
											sendSyncMessage("pause")
										}
									}}
									disabled={clientId !== 0}
								>
									{isPaused() ? "⏵" : "⏸"}
								</button>
							</div>

							<div class="control-group volume-control">
								<label>
									Volume
									<input
										id="volume"
										type="range"
										min="0"
										max="100"
										value={volume()}
										onInput={changeVolume}
									/>
								</label>
							</div>

							{/* SYNC + Quick Buttons */}
							<div class="control-group">
								{clientId === 0 && (
									<button class="controls-button" onClick={runLeader}>
										Announce Sync
									</button>
								)}
								<button class="controls-button" onClick={() => setShowChat(!showChat())}>
									{showChat() ? "Hide Chatbox" : "Show Chatbox"}
								</button>

								<button class="controls-button" onClick={goToMainMenu}>
									Go to Main Menu
								</button>
							</div>
						</div>
					</div>
				</div>

				{/* CHAT SECTION */}
				<div
					class="chat-section"
					style={{display: showChat() ? 'flex' : 'none'}}
				>
					<div class="chat-header">Live Media over QUIC Chat</div>
					<div class="chat-messages">{/* Messages will appear here */}</div>
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

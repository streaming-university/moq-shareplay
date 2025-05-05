import { WebSocketServer } from "ws";
import https from "https";
import fs from "fs";
import path from "path";

// const server = https.createServer({
// 	key: fs.readFileSync(path.join("/etc/letsencrypt/live/streaming.university", "privkey.pem")),
// 	cert: fs.readFileSync(path.join("/etc/letsencrypt/live/streaming.university", "fullchain.pem")),
// });

const wss = new WebSocketServer({ port: 8005 });

const clients = new Map(); // Map<ws, { lastSeen, meta }>
const rooms = new Map();   // Map<roomName, Set<ws>>


// Always create empty rooms at startup
for (let i = 1; i <= 5; i++) {
	rooms.set(`room${i}`, new Set());
}
const pendingNamespaceUpdate = new Map(); // Map<roomName, boolean>

// Publisher references
let pub1 = null;
let pub2 = null;
let pub3 = null;
let pub4 = null;
let pub5 = null;

wss.on("connection", (ws) => {
	console.log("Client connected");

	ws.on("message", (message) => {
		const raw = message.toString();
		console.log("Received message:", raw);

		// Handle simple pub registration
		switch (raw) {
			case "pub1": pub1 = ws; console.log("pub1 connected"); return;
			case "pub2": pub2 = ws; console.log("pub2 connected"); return;
			case "pub3": pub3 = ws; console.log("pub3 connected"); return;
			case "pub4": pub4 = ws; console.log("pub4 connected"); return;
			case "pub5": pub5 = ws; console.log("pub5 connected"); return;
		}

		try {
			const data = JSON.parse(raw);

			// Handle room status request
			if (data.type === "status-request") {
				const roomStatuses = {};

				for (const [roomName, clientSet] of rooms.entries()) {
					let leaderPresent = false;
					let clientCount = clientSet.size;

					for (const client of clientSet) {
						const meta = clients.get(client)?.meta;
						if (meta?.role === "leader") {
							leaderPresent = true;
							break;
						}
					}

					roomStatuses[roomName] = {
						leaderPresent,
						clientCount,
					};
				}

				const response = {
					type: "status-response",
					rooms: roomStatuses,
				};

				ws.send(JSON.stringify(response));
				return;
			}
			// Handle leader disconnect
			if (data.type === "disconnect" && data.role === "leader" && data.room) {
				console.log(`[LEADER DISCONNECT] Room: ${data.room}, ID: ${data.id}`);
				pendingNamespaceUpdate.set(data.room, true);
				console.log("Pending rooms waiting for leader:", Array.from(pendingNamespaceUpdate.entries()));
				return;
			}

			console.log("Pending rooms waiting for leader:", Array.from(pendingNamespaceUpdate.entries()));

			const isValid = typeof data.room === "string" &&
				typeof data.role === "string" &&
				typeof data.namespace === "string";

			console.log("Is valid: ", isValid);
			if (isValid) {
				clients.set(ws, { lastSeen: Date.now(), meta: data });

				if (!rooms.has(data.room)) {
					rooms.set(data.room, new Set());
				}
				rooms.get(data.room).add(ws);

				// If a leader joined and we’re waiting to send a new namespace
				if (data.role === "leader" && pendingNamespaceUpdate.get(data.room)) {
					const newNamespace = `sync-namespace-room1-${Math.floor(100000 + Math.random() * 900000)}`;
					console.log("New namespace, ", newNamespace);
					pendingNamespaceUpdate.delete(data.room);


					const roomClients = rooms.get(data.room);
					console.log(`[WS] Connected clients in room '${data.room}':`);

					if (roomClients) {
						for (const client of roomClients) {
							const clientInfo = clients.get(client);
							console.log("→", {
								readyState: client.readyState,
								meta: clientInfo?.meta,
							});
						}
					} else {
						console.log("[WS] No clients found for this room.");
					}
					const pubMap = {
						room1: pub1,
						room2: pub2,
						room3: pub3,
						room4: pub4,
						room5: pub5,
					};

					const pub = pubMap[data.room];

					if (pub && pub.readyState === 1) {
						const pubPayload = {
							type: "namespace-update",
							room: data.room,
							newNamespace,
						};

						try {
							const payload = JSON.stringify(pubPayload);
							console.log(`[WS] Also sending namespace-update to ${data.room} publisher:`, payload);
							pub.send(payload);
						} catch (err) {
							console.error(`[WS] Failed to send namespace-update to ${data.room} publisher:`, err);
						}
					}
					if (roomClients) {
						for (const client of roomClients) {
							if (client.readyState === 1) {
								const namespacePayload = {
									type: "namespace-update",
									room: data.room,
									newNamespace: newNamespace,
								};
								console.log("Following will be converted to json", namespacePayload)
								try {
									const payload = JSON.stringify(namespacePayload);
									console.log("[WS] Sending to client:", payload);

									client.send(payload);
								} catch (err) {
									console.error("[WS] Failed to stringify or send message:", err);
									console.log("Payload that failed:", namespacePayload);
								}
							}
						}
						console.log(`[NAMESPACE UPDATED] Room: ${data.room}, New: ${newNamespace}`);
					}
				}
			} else {
				const existing = clients.get(ws);
				if (existing) existing.lastSeen = Date.now(); // still update heartbeat
			}
		} catch (e) {
			console.warn("Invalid JSON message received");
		}
	});

	ws.on("close", () => {
		const meta = clients.get(ws)?.meta;
		if (meta) {
			const roomSet = rooms.get(meta.room);
			if (roomSet) {
				roomSet.delete(ws);
			}
		}

		clients.delete(ws);

		// Clear publisher references
		if (ws === pub1) pub1 = null;
		if (ws === pub2) pub2 = null;
		if (ws === pub3) pub3 = null;
		if (ws === pub4) pub4 = null;
		if (ws === pub5) pub5 = null;

		console.log("Client disconnected");
	});
});


// server.listen(8005, () => {
// 	console.log("Secure WebSocket server running at port 8005");
// });

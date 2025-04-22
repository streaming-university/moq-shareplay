import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });

// Map<ws, { lastSeen, meta }>
const room1 = new Map();
let pub1 = null;
let pub2 = null;
let pub3 = null;
let pub4 = null;
let pub5 = null;

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (message) => {
	console.log("Received message:", message.toString());
	switch (message) {
	  case "pub1":
		pub1 = ws;
		console.log("pub1 connected");
		return;
	  case "pub2":
		pub2 = ws;
		console.log("pub2 connected");
		return;
	  case "pub3":
		pub3 = ws;
		console.log("pub3 connected");
		return;
	  case "pub4":
		pub4 = ws;
		console.log("pub4 connected");
		return;
	  case "pub5":
		pub5 = ws;
		console.log("pub5 connected");
		return;
	}

    try {
	  const data = JSON.parse(message.toString());
      if (
        typeof data.room === "string" &&
        typeof data.role === "string" &&
        typeof data.id === "string" &&
        typeof data.namespace === "string"
      ) {
		
        room1.set(ws, {
          lastSeen: Date.now(),
          meta: {
            room: data.room,
            role: data.role,
            id: data.id,
            namespace: data.namespace,
          },
        });
      } else {
        // Not a valid heartbeat message – just update timestamp
        const client = room1.get(ws);
        if (client) {
          client.lastSeen = Date.now();
        }
      }
    } catch (e) {
      console.warn("Invalid message received");
    }
  });

  ws.on("close", () => {
  });
});


setInterval(() => {
  const now = Date.now();
  for (const [ws, client] of room1.entries()) {
    if (now - client.lastSeen > 5000) {
      console.log("Removing inactive client:", client.meta);
      room1.delete(ws);
    }
  }
}, 1000);

console.log("WebSocket server running on ws://localhost:8080");

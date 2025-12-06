# Setup
## moq-js (web)
```
cd repos/moq-js; npm install
```
## moq-rs 
Does not require any setup for now.

# Run
## moq-js (web)
```
# Open a new terminal, then type:
cd repos/moq-js; npm run dev
```
## moq-rs (relay and publisher)
**Note:** Wait for the compilation in the first ever run.
```
# Open a new terminal, then type below to run Relay server:
cd repos/moq-rs; ./dev/relay
```
```
# Open a new terminal, then type below to run a Publisher:
cd repos/moq-rs; ./dev/pub <room_name>
```

## Room Server
```
# Open a new terminal and type:
cd repos/moq-js/web; node ws-server.js
```
# Watch in Browser
As a leader : ```https://localhost:4321/?room=room<room_name>&role=leader```

As a follower : ```https://localhost:4321/?room=room<room_name>&role=follower<id>```

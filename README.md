# Prerequisites
- Rust
- Go (for certificate creation)
- Ffmpeg
- Node.js (npm, TypeScript, JavaScript)

# Installation & Setup
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
## moq-rs
**Note:** Wait for the compilation in the first ever run.
```
# Open a new terminal, then type:
cd repos/moq-rs; ./dev/relay
```
```
# Open a new terminal, then type:
cd repos/moq-rs; ./dev/pub <room_name>
```

# Watch in Browser
As a leader : ```https://localhost:4321/?room=room<room_name>&role=leader```

As a follower : ```https://localhost:4321/?room=room<room_name>&role=follower<id>```


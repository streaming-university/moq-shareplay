#!/usr/bin/env bash
room=$1
if [[ -z $room ]]; then
  echo "Please specify a room!"
  exit 1
fi
port=4444
cd /opt/shareplay-demo/repos/moq-rs/ && HOST=shareplay.streaming.university PORT=$port dev/pub $room

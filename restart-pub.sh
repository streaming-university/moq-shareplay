#!/bin/bash
room=$1
while true; do
    echo "Starting start-pub.sh for room $1..."
    nohup ./start-pub.sh $room >> pub-$room.log 2>&1 &
    PID=$!
    wait $PID
    echo "start-pub.sh (room: $1) crashed or exited. Restarting in 5 seconds..."
    sleep 5
done

#!/usr/bin/env bash
# This script restarts all the processes

# End the all of the processes
./kill-all.sh
echo "Killed all"

sleep 2

echo "Starting relay"
nohup ./start-relay.sh 2>&1 > relay.log &

sleep 5

room_count=5

echo "Starting publishers for $room_count rooms"
for i in {1..$room_count}; do
  nohup ./restart-pub.sh $i > restart_$i.log 2>&1 &
  sleep 3
done

# starting the client
nohup ./run-client.sh 2>&1 > client.log &

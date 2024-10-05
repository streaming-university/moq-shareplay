#!/bin/bash

base_dir=$(pwd)

cd $base_dir/moq-rs
gnome-terminal -- bash -c "./dev/relay; exec bash" &
sleep 3
gnome-terminal -- bash -c "./dev/pub; exec bash" &
# sleep 3
# cd $base_dir/moq-js
# gnome-terminal -- bash -c "npm run dev; exec bash" &
#!/bin/bash

base_dir=$(pwd)

cd $base_dir/repos/moq-rs
gnome-terminal -- bash -c "./dev/relay; exec bash" &
sleep 3
gnome-terminal -- bash -c "./dev/pub; exec bash" &
cd $base_dir/repos/moq-js
sleep 1
gnome-terminal -- bash -c "npm run dev; exec bash" &
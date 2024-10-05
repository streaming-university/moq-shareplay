#!/bin/bash

base_dir=$(pwd)

cd $base_dir/repos/moq-rs
gnome-terminal -- bash -c "./dev/relay; exec bash" &
sleep 3
gnome-terminal -- bash -c "./dev/pub; exec bash" &
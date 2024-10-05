#!/bin/bash

moq_rs="$(pwd)/repos/moq-rs"
moq_js="$(pwd)/repos/moq-js"

gnome-terminal -- bash -c "cd ${moq_rs}; ./dev/relay; exec bash" &

sleep 3

gnome-terminal -- bash -c "cd ${moq_rs}; ./dev/pub; exec bash" &

sleep 2

gnome-terminal -- bash -c "cd ${moq_js}; npm run dev; exec bash" &
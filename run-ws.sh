#!/usr/bin/env bash

. ~/.nvm/nvm.sh
cd /opt/shareplay-demo/repos/moq-js/
nvm use 22

while true; do
    echo "Starting ws-server at $(date)"
    npm run ws
    echo "ws-server crashed or stopped. Restarting in 2 seconds..."
    sleep 2
done

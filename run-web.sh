#!/usr/bin/env bash

. ~/.nvm/nvm.sh
cd /opt/shareplay-demo/repos/moq-js/
nvm use 22

while true; do
    echo "Starting moq-js at $(date)"
    npm run web
    echo "moq-js crashed or stopped. Restarting in 2 seconds..."
    sleep 2
done

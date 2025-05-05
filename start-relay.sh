#!/usr/bin/env bash

cd /opt/shareplay-demo/repos/moq-rs/ && CERT=/etc/letsencrypt/live/streaming.university/fullchain.pem KEY=/etc/letsencrypt/live/streaming.university/privkey.pem PORT=4444 dev/relay

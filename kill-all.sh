#!/usr/bin/env bash

# kill pubs
echo "Killing publishers"
#ps -eF | grep restart | grep -v grep | awk '{print $2}' | xargs -I @@ kill @@
#ps -eF | grep pub | grep 4444 | grep -v grep | awk '{print $2}' | xargs -I @@ kill @@

# kill relay
echo "Killing relay"
#ps -eF | grep relay | grep 4444 | grep -v grep | awk '{print $2}' | xargs -I @@ kill @@
# kill the client
echo "Killing client"
#bash kill-npm.sh

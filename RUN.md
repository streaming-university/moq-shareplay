ws-server: nohup ./run-ws.sh > client.log 2>&1 &
web: nohup ./run-web.sh > client.log 2>&1 &
relay: nohup ./start-relay.sh 2>&1 > /dev/null &
pub<id>: nohup ./start-pub.sh <id> 2>&1 > /dev/null &

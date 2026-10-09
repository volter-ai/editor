H=$(cat /tmp/cyclotron-blind-home.txt)
cd "$H/Cyclotron/my-race"
export HOME="$H" PATH="$H/.volter/node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
{
  date -u +%H:%M:%SZ
  npx --no-install cyclotron close 2>&1 | tail -3
  sleep 3
  echo "left from the test home:"
  ps -axo pid,command | grep -F "$H" | grep -v grep | cut -c1-160
  echo "end"
} > /tmp/cyclotron-blind-close.log 2>&1
exec sleep 300

H=$(cat /tmp/cyclotron-blind-home.txt)
cd "$H/Cyclotron/my-race"
export HOME="$H" PATH="$H/.volter/node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  s=$(npx --no-install cyclotron status 2>&1 | head -c 600)
  echo "t+$((i*10))s status: $(echo "$s" | tr '\n' ' ' | head -c 300)"
  case "$s" in *'"ready": true'*|*'ready'*) ;; esac
  sleep 10
done
npx --no-install cyclotron screenshot --out /tmp/cyclotron-blind-shot1.png 2>&1 | tail -2
npx --no-install cyclotron capture --out /tmp/cyclotron-blind-capture1.png 2>&1 | tail -2
echo LOOK-DONE
exec sleep 7200

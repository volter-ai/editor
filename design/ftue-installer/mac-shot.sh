H=$(cat /tmp/cyclotron-blind-home.txt)
cd "$H/Cyclotron/my-race"
export HOME="$H" PATH="$H/.volter/node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx --no-install cyclotron help 2>&1 | grep -i -E "screenshot|capture" | head -4
npx --no-install cyclotron screenshot 2>&1 | tail -3
echo SHOT-DONE
exec sleep 7200

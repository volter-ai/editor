H=$(cat /tmp/cyclotron-blind-home.txt)
cd "$H/Cyclotron/my-race"
export HOME="$H" PATH="$H/.volter/node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx --no-install cyclotron eval --list 2>&1 | head -60
echo LIST-DONE
exec sleep 3600

H=$(cat /tmp/cyclotron-blind-home.txt)
cd "$H/Cyclotron/my-race"
export HOME="$H" PATH="$H/.volter/node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx --no-install cyclotron capture --region page --out /tmp/cyclotron-blind-page1.png --force 2>&1 | tail -2
echo PAGE-DONE
exec sleep 7200

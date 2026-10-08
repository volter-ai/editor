H=$(cat /tmp/cyclotron-blind-home.txt)
cd "$H/Cyclotron/my-race"
export HOME="$H" PATH="$H/.volter/node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
{
  date -u +%H:%M:%SZ
  npx --no-install cyclotron eval "const s = await editor.command('supercode.frontend.setupState'); return JSON.stringify(s)" 2>&1
  ls "$H/.volter/agents/bin" "$H/.volter/node/bin" 2>&1 | tr '\n' ' '
  echo
  npx --no-install cyclotron capture --region page --out /tmp/cyclotron-blind-page3.png --force 2>&1 | tail -1
} > /tmp/cyclotron-blind-state.log 2>&1
echo STATE-DONE
exec sleep 600

H=$(cat /tmp/cyclotron-blind-home.txt)
cd "$H/Cyclotron/my-race"
export HOME="$H" PATH="$H/.volter/node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
{
  date -u +%H:%M:%SZ
  ls -la "$H/.codex" 2>&1 | head -4
  npx --no-install cyclotron eval "const s = await editor.command('supercode.frontend.setupState'); return JSON.stringify({ visible: s && s.visible, rows: (s && s.rows || []).map(r => [r.harness, r.phase, r.signedIn, r.buttonLabel]) })" 2>&1 | head -1
  npx --no-install cyclotron chat status 2>&1 | head -12
  npx --no-install cyclotron capture --region page --out /tmp/cyclotron-blind-page4.png --force 2>&1 | tail -1
} > /tmp/cyclotron-blind-state2.log 2>&1
echo DONE
exec sleep 600

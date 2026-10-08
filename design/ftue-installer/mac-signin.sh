H=$(cat /tmp/cyclotron-blind-home.txt)
cd "$H/Cyclotron/my-race"
export HOME="$H" PATH="$H/.volter/node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
start=$(date +%s)
echo "click at $(date -u +%H:%M:%SZ)"
npx --no-install cyclotron eval "return await editor.command('supercode.frontend.beginSetup', 'codex')" 2>&1 | tail -2
for t in 3 8 15 25 40 60 90; do
  sleep $(( t - ($(date +%s) - start) > 0 ? t - ($(date +%s) - start) : 0 ))
  npx --no-install cyclotron eval "const s = await editor.command('supercode.frontend.setupState'); return JSON.stringify((s && s.rows || []).map(r => [r.harness, r.phase, r.buttonLabel, r.caption, r.busy])) + ' visible=' + (s && s.visible)" 2>&1 | tail -1 | sed "s/^/+${t}s /"
done
npx --no-install cyclotron capture --region page --out /tmp/cyclotron-blind-page2.png --force 2>&1 | tail -1
echo SIGNIN-OBSERVED
exec sleep 7200

H=$(mktemp -d /tmp/cyclotron-blind.XXXXXX)
echo "HOME=$H"
echo "$H" > /tmp/cyclotron-blind-home.txt
start=$(date +%s)
echo "paste at $(date -u +%H:%M:%SZ)"
cd "$H"
env -i HOME="$H" USER="$USER" LOGNAME="$LOGNAME" PATH=/usr/bin:/bin:/usr/sbin:/sbin TERM=xterm-256color LANG=en_US.UTF-8 TMPDIR=/tmp \
  /bin/zsh -c 'curl -fsSL https://cyclotron.videogame.ai/install.sh | sh' 2>&1 |
  while IFS= read -r line; do printf '%4ss %s\n' "$(( $(date +%s) - start ))" "$line"; done
echo "returned after $(( $(date +%s) - start ))s"
exec sleep 14400

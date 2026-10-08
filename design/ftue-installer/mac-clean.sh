H=$(cat /tmp/cyclotron-blind-home.txt)
case "$H" in /tmp/cyclotron-blind.*) rm -rf "$H" ;; esac
rm -f /tmp/cyclotron-blind-*.sh /tmp/cyclotron-blind-*.log /tmp/cyclotron-blind-*.png /tmp/cyclotron-blind-home.txt /tmp/cyclotron-blind-run.sh
ls -d /tmp/cyclotron-blind* 2>/dev/null || echo "clean"

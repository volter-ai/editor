{
  echo "node: $(command -v node) $(node -v 2>&1)"; echo "npm: $(npm -v 2>&1)"; echo "git: $(git --version 2>&1)"; echo "xcode: $(xcode-select -p 2>&1)"; echo "python3: $(python3 --version 2>&1)"
  df -h / /Volumes/PeakSSD 2>&1 | tail -3
  ls -d /Volumes/PeakSSD/*code-oss* /Volumes/PeakSSD/*workbench* ~/*code-oss* 2>/dev/null | head -10
  sysctl -n hw.memsize | awk '{print "RAM GB:", $1/1073741824}'
} > /tmp/cyc-probe.log 2>&1

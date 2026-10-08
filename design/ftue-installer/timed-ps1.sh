#!/bin/sh
# The Windows first-run as a newcomer, every output line stamped with seconds since the paste.
# Fresh home, roaming data and npm cache; PATH holds only Windows itself. LOCALAPPDATA stays the owner's.
set -eu
root=/c/Users/porta/Desktop/volter/ftue-installer
rm -rf "$root/home" "$root/npm-cache"
mkdir -p "$root/home/AppData/Roaming" "$root/npm-cache"
win_root='C:\Users\porta\Desktop\volter\ftue-installer'
export USERPROFILE="$win_root\\home"
export HOMEDRIVE=C:
export HOMEPATH="${USERPROFILE#C:}"
export APPDATA="$win_root\\home\\AppData\\Roaming"
export npm_config_cache="$win_root\\npm-cache"
start=$(date +%s)
echo "paste at $(date -u +%H:%M:%SZ)"
PATH="/c/Windows/System32:/c/Windows:/c/Windows/System32/WindowsPowerShell/v1.0" \
  /c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command "irm https://cyclotron.videogame.ai/install.ps1 | iex" 2>&1 |
  while IFS= read -r line; do printf '%4ss %s\n' "$(( $(date +%s) - start ))" "$line"; done
echo "returned after $(( $(date +%s) - start ))s"

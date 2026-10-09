#!/bin/sh
# A first-time Windows user with no Node.js: fresh home, roaming data and npm cache; PATH holds only Windows itself.
# LOCALAPPDATA stays the owner's, so the editor opens in the owner's Chrome as it would for that user.
set -eu
root=/c/Users/porta/Desktop/volter/ftue-installer
[ "${KEEP_HOME:-}" = 1 ] || rm -rf "$root/home"
mkdir -p "$root/home/AppData/Roaming" "$root/npm-cache"
win_root='C:\Users\porta\Desktop\volter\ftue-installer'
script='C:\Users\porta\Desktop\volter\sites-home\model-editor\src\install.ps1'
export USERPROFILE="$win_root\\home"
export HOMEDRIVE=C:
export HOMEPATH="${USERPROFILE#C:}"
export APPDATA="$win_root\\home\\AppData\\Roaming"
export npm_config_cache="$win_root\\npm-cache"
export PATH="/c/Windows/System32:/c/Windows:/c/Windows/System32/WindowsPowerShell/v1.0"
exec /c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command "Get-ExecutionPolicy; Get-Content -Raw '$script' | iex; 'installer returned'"

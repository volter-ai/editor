# Runs one command as a first-time user of this Windows PC, for the blind walks that need one
# (LAUNCH-CHECKLIST.md, stage 2: walk 3 "Node removed from PATH", walk 4 "empty agent profile").
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File release/launch/walks/first-time-env.ps1 -NoNode -EmptyProfile -Command "irm https://cyclotron.videogame.ai/install.ps1 | iex"
#
# (Windows refuses script files by default; -ExecutionPolicy Bypass applies to that one process only.)
#
# -NoNode        PATH loses every entry that holds node.exe, and nvm's and npm's global folders, so neither
#                `node` nor `npx` nor an npm-installed CLI resolves.
# -EmptyProfile  The home folders (USERPROFILE, HOME, APPDATA, LOCALAPPDATA) point at an empty profile under
#                -ProfileRoot, so no agent's credentials (~/.claude, ~/.codex), no ~/.volter and no npm cache are
#                found: what a person who never signed in sees. Agent CLIs already on PATH stay installed, signed out.
#                A walk goes as far as the sign-in screen and starts no sign-in (the owner's standing rule).
# -Fresh         Empties -ProfileRoot first, so the walk starts from nothing. Without it, a second run is the
#                returning user.
#
# It changes nothing outside -ProfileRoot: the variables live only in the child process it starts.
param(
	[Parameter(Mandatory = $true)][string]$Command,
	[switch]$NoNode,
	[switch]$EmptyProfile,
	[switch]$Fresh,
	[string]$ProfileRoot = (Join-Path $env:TEMP 'cyclotron-first-time')
)
$ErrorActionPreference = 'Stop'

$env:Path = (($env:Path -split ';') | Where-Object {
	if (-not $_) { return $false }
	if (-not $NoNode) { return $true }
	$dir = [Environment]::ExpandEnvironmentVariables($_)
	if ($dir -match '(?i)\\(nvm|nvm4w|npm|volta|fnm)(\\|$)' -or $_ -match '(?i)%NVM_') { return $false }
	-not (Test-Path -LiteralPath (Join-Path $dir 'node.exe'))
}) -join ';'

if ($EmptyProfile) {
	if ($Fresh -and (Test-Path -LiteralPath $ProfileRoot)) { Remove-Item -LiteralPath $ProfileRoot -Recurse -Force }
	$roaming = Join-Path $ProfileRoot 'AppData\Roaming'
	$local = Join-Path $ProfileRoot 'AppData\Local'
	New-Item -ItemType Directory -Force -Path $roaming, $local | Out-Null
	$env:USERPROFILE = $ProfileRoot
	$env:HOME = $ProfileRoot
	$env:APPDATA = $roaming
	$env:LOCALAPPDATA = $local
	$env:TEMP = $env:TMP = (New-Item -ItemType Directory -Force -Path (Join-Path $local 'Temp')).FullName
	foreach ($name in 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'SUPERCODE_HOME', 'SUPERCODE_BIN', 'XDG_CONFIG_HOME', 'npm_config_cache', 'npm_config_prefix') {
		Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
	}
}

Write-Host "first-time-env: NoNode=$NoNode EmptyProfile=$EmptyProfile home=$env:USERPROFILE"
Set-Location -LiteralPath $env:USERPROFILE
# Encoded, because Windows strips a nested command line's inner double quotes and the words then run as commands.
powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("`$ProgressPreference = 'SilentlyContinue'`n$Command")))
exit $LASTEXITCODE

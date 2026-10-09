# Runs one command as a first-time user of this Windows PC, for the blind walks that need one
# (LAUNCH-CHECKLIST.md, stage 2: walk 3 "Node removed from PATH", walk 4 "empty agent profile").
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File release/launch/walks/first-time-env.ps1 -NoNode -EmptyProfile -Command "irm https://cyclotron.videogame.ai/install.ps1 | iex"
#
# (Windows refuses script files by default; -ExecutionPolicy Bypass applies to that one process only.)
#
# -NoNode        PATH loses every entry that holds node.exe, and nvm's and npm's global folders, so neither
#                `node` nor `npx` nor an npm-installed CLI resolves.
# -EmptyProfile  The home folders (USERPROFILE, HOME, HOMEDRIVE/HOMEPATH, APPDATA, LOCALAPPDATA) and CODEX_HOME
#                point at an empty profile under -ProfileRoot, and every ANTHROPIC_*, CLAUDE*, OPENAI_*, CODEX_*,
#                SUPERCODE_* and XDG_* variable is dropped, so no agent's credentials (~/.claude, ~/.codex, an API
#                key), no ~/.volter and no npm cache are found: what a person who never signed in sees. Agent CLIs
#                already on PATH stay installed, signed out. A walk goes as far as the sign-in screen and starts no
#                sign-in (the owner's standing rule).
# -Fresh         Deletes -ProfileRoot first, so the walk starts from nothing; only a folder this script made (its
#                marker is inside) and never a drive root or a real profile, TEMP or system folder. Without it, a
#                run is the returning user.
#
# Started with `powershell -File`, it changes nothing outside -ProfileRoot: the variables live only in this process
# and the child it starts. The browser's own storage is the browser's, and -Fresh does not reach it.
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
	-not (Test-Path -LiteralPath "$dir\node.exe")
}) -join ';'

if ($EmptyProfile) {
	# The profile is only ever a folder this script made (its marker inside), and never a drive root, the real
	# profile, TEMP itself, or a folder above one of them: -Fresh deletes it.
	$root = [IO.Path]::GetFullPath($ProfileRoot).TrimEnd('\')
	$marker = Join-Path $root '.cyclotron-first-time'
	$guarded = @([Environment]::GetFolderPath('UserProfile'), $env:USERPROFILE, $env:TEMP, $env:LOCALAPPDATA, $env:APPDATA, $env:SystemRoot) |
		Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') }
	if ($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\') -or ($guarded | Where-Object { $_ -eq $root -or $_.StartsWith("$root\", [StringComparison]::OrdinalIgnoreCase) })) {
		throw "first-time-env: $root cannot be the empty profile (a drive root, or a real profile, TEMP or system folder, or above one)."
	}
	# On every run, not only -Fresh: the marker is written below, and a folder marked once is one -Fresh may delete.
	if ((Test-Path -LiteralPath $root) -and (Get-ChildItem -LiteralPath $root -Force | Measure-Object).Count -and -not (Test-Path -LiteralPath $marker)) {
		throw "first-time-env: $root is not empty and was not made by this script; refusing to use it as the empty profile."
	}
	if ($Fresh -and (Test-Path -LiteralPath $root)) {
		# Not Remove-Item -Recurse, which in Windows PowerShell 5.1 can follow a junction out of the folder.
		# Through the \\?\ prefix: a walk's profile holds paths over 260 characters (npm's cache, a
		# PowerShell module, 265 measured), which Windows PowerShell 5.1's .NET cannot delete otherwise.
		[IO.Directory]::Delete("\\?\$root", $true)
	}
	$roaming = Join-Path $root 'AppData\Roaming'
	$local = Join-Path $root 'AppData\Local'
	$codex = Join-Path $root '.codex'
	New-Item -ItemType Directory -Force -Path $roaming, $local, $codex | Out-Null
	Set-Content -LiteralPath $marker -Value 'An empty first-time profile made by release/launch/walks/first-time-env.ps1.'
	# Every agent's and supercode's own settings and credentials from the environment, then the home folders.
	Get-ChildItem Env: | Where-Object { $_.Name -match '^(ANTHROPIC_|CLAUDE|OPENAI_|CODEX_|SUPERCODE_|XDG_)' } |
		ForEach-Object { Remove-Item -LiteralPath "Env:$($_.Name)" }
	foreach ($name in 'npm_config_cache', 'npm_config_prefix') { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
	$env:USERPROFILE = $root
	$env:HOME = $root
	$env:HOMEDRIVE = [IO.Path]::GetPathRoot($root).TrimEnd('\')
	$env:HOMEPATH = $root.Substring($env:HOMEDRIVE.Length)
	$env:APPDATA = $roaming
	$env:LOCALAPPDATA = $local
	# Codex finds its home through Windows itself, not USERPROFILE: it is named outright.
	$env:CODEX_HOME = $codex
	$env:TEMP = $env:TMP = (New-Item -ItemType Directory -Force -Path (Join-Path $local 'Temp')).FullName
}

Write-Host "first-time-env: NoNode=$NoNode EmptyProfile=$EmptyProfile home=$env:USERPROFILE"
Set-Location -LiteralPath $env:USERPROFILE
# Encoded, because Windows strips a nested command line's inner double quotes and the words then run as commands.
powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("`$ProgressPreference = 'SilentlyContinue'`n$Command")))
exit $LASTEXITCODE

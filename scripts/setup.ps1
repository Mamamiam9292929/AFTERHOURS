# AFTERHOURS - lokale Umgebung unter Windows einrichten und starten.
# Aufruf ueber AFTERHOURS-starten.cmd (Doppelklick). Protokoll: setup.log im Projektordner.
# Das Skript ist wiederholbar: bereits erledigte Schritte werden uebersprungen.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
Start-Transcript -Path (Join-Path $root 'setup.log') -Force | Out-Null

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Green }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Fail($msg) {
  Write-Host ''
  Write-Host "FEHLER: $msg" -ForegroundColor Red
  Stop-Transcript | Out-Null
  Read-Host 'Enter zum Schliessen'
  exit 1
}
function Docker-Ready { docker info *> $null; return ($LASTEXITCODE -eq 0) }

# 1. Node.js -------------------------------------------------------------------------------
Step 'Node.js pruefen'
if (-not (Have 'node') -and (Have 'winget')) {
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  Refresh-Path
}
if (-not (Have 'node')) { Fail 'Node.js fehlt. LTS-Version von https://nodejs.org installieren und das Skript erneut starten.' }
$nodeVersion = (node -v).Trim().TrimStart('v')
Write-Host "Node $nodeVersion"
if ([version]$nodeVersion -lt [version]'20.19.0') { Fail "Node $nodeVersion ist zu alt (benoetigt mindestens 20.19). Node LTS neu installieren." }

# 2. Docker --------------------------------------------------------------------------------
Step 'Docker pruefen'
if (-not (Have 'docker')) {
  if (Have 'winget') {
    winget install --id Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
  }
  Fail 'Docker Desktop war nicht installiert. Nach der Installation Windows neu starten, Docker Desktop einmal oeffnen (Nutzungsbedingungen bestaetigen) und dieses Skript erneut starten.'
}
if (-not (Docker-Ready)) {
  $dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $dockerDesktop) { Start-Process $dockerDesktop }
  Write-Host 'Docker startet, warte bis zu 3 Minuten ...'
  for ($i = 0; $i -lt 36; $i++) {
    Start-Sleep -Seconds 5
    if (Docker-Ready) { break }
  }
  if (-not (Docker-Ready)) { Fail 'Docker laeuft nicht. Docker Desktop oeffnen, warten bis "Engine running" angezeigt wird, dann erneut starten.' }
}
Write-Host ('Docker Engine ' + (docker version --format '{{.Server.Version}}'))

# 3. Abhaengigkeiten -----------------------------------------------------------------------
Step 'Abhaengigkeiten installieren (npm install)'
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail 'npm install ist fehlgeschlagen. Details stehen oben und in setup.log.' }

# 4. Supabase ------------------------------------------------------------------------------
Step 'Supabase starten (beim ersten Mal werden Docker-Images geladen, das dauert einige Minuten)'
npx supabase status *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host 'Supabase laeuft bereits.'
} else {
  npx supabase start
  if ($LASTEXITCODE -ne 0) { Fail 'supabase start ist fehlgeschlagen. Details stehen oben und in setup.log.' }
}

Step 'Neue Datenbank-Migrationen einspielen'
npx supabase migration up --local
if ($LASTEXITCODE -ne 0) { Fail 'Die Migrationen konnten nicht eingespielt werden. Details stehen oben und in setup.log.' }

$values = @{}
foreach ($line in (npx supabase status -o env)) {
  if ($line -match '^([A-Z_]+)="?([^"]*)"?$') { $values[$Matches[1]] = $Matches[2] }
}
$apiUrl = $values['API_URL']
$anonKey = $values['ANON_KEY']
if (-not $anonKey) { $anonKey = $values['PUBLISHABLE_KEY'] }
if (-not $apiUrl -or -not $anonKey) { Fail 'Konnte API-URL oder anon-Key aus "supabase status" nicht lesen.' }

# 5. .env.local ----------------------------------------------------------------------------
Step '.env.local schreiben'
$envText = @"
# Automatisch von scripts/setup.ps1 erzeugt (lokale Supabase-Umgebung).
VITE_SUPABASE_URL=$apiUrl
VITE_SUPABASE_ANON_KEY=$anonKey
VITE_SITE_URL=http://127.0.0.1:5173
VITE_ASSISTANT_ENABLED=false
"@
[IO.File]::WriteAllText((Join-Path $root '.env.local'), $envText, (New-Object Text.UTF8Encoding $false))
Write-Host "API: $apiUrl"

# 6. App starten ---------------------------------------------------------------------------
Step 'App starten'
$running = $false
try { Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 2 | Out-Null; $running = $true } catch { }
if ($running) { Write-Host 'Die App laeuft bereits.' }
$devCommand = "Set-Location -LiteralPath '$root'; npm run dev 2>&1 | Tee-Object -FilePath dev.log"
if (-not $running) { Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $devCommand }
$ready = $running
for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
  Start-Sleep -Seconds 1
  try { Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 2 | Out-Null; $ready = $true; break } catch { }
}
if (-not $ready) { Fail 'Der Entwicklungsserver antwortet nicht. Siehe das zweite Fenster bzw. dev.log.' }

Start-Process 'http://127.0.0.1:5173'
Start-Process 'http://127.0.0.1:54324'

Write-Host ''
Write-Host 'FERTIG.' -ForegroundColor Green
Write-Host '  App:              http://127.0.0.1:5173'
Write-Host '  Postfach (Mails): http://127.0.0.1:54324'
Write-Host '  Datenbank-Studio: http://127.0.0.1:54323'
Write-Host 'Beenden: Fenster "npm run dev" schliessen, dann AFTERHOURS-stoppen.cmd.'
Stop-Transcript | Out-Null
Read-Host 'Enter zum Schliessen'

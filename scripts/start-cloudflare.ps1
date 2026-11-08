param(
    [ValidateSet('http2', 'quic', 'auto')]
    [string]$Protocol = 'http2',
    [string]$CloudflaredPath = ''
)

$ErrorActionPreference = 'Stop'
$backendPath = Split-Path -Parent $PSScriptRoot
$port = 5000
$portLine = Get-Content -LiteralPath (Join-Path $backendPath '.env') |
    Where-Object { $_ -match '^\s*PORT\s*=\s*\d+\s*$' } | Select-Object -Last 1
if ($portLine) { $port = [int]($portLine -replace '^.*=\s*', '') }
if ($port -lt 1 -or $port -gt 65535) { throw 'PORT invalida no .env.' }

if (-not $CloudflaredPath) {
    $command = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($command) { $CloudflaredPath = $command.Source }
    else { $CloudflaredPath = Join-Path $env:USERPROFILE '.codex\tools\cloudflared\cloudflared.exe' }
}
if (-not (Test-Path -LiteralPath $CloudflaredPath -PathType Leaf)) {
    throw 'cloudflared nao encontrado. Informe -CloudflaredPath com o executavel oficial.'
}
if (Get-NetTCPConnection -LocalPort 20241 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Ja existe um processo usando a porta de diagnostico 20241. Confira-o antes de iniciar outro tunel.'
}
$client = New-Object System.Net.Sockets.TcpClient
try { $client.Connect('127.0.0.1', $port) }
catch { throw "Backend indisponivel na porta $port. Inicie npm start primeiro." }
finally { $client.Dispose() }

$logPath = Join-Path $backendPath 'logs\cloudflare'
New-Item -ItemType Directory -Path $logPath -Force | Out-Null
$logFile = Join-Path $logPath ("tunnel-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
Write-Host "Origem: http://127.0.0.1:$port | IPv4 | $Protocol"
Write-Host "Log: $logFile"
Write-Host 'Mantenha este processo aberto. Confira o tunel com node scripts/check-cloudflare.js.'
& $CloudflaredPath tunnel --edge-ip-version 4 --protocol $Protocol --metrics 127.0.0.1:20241 --loglevel info --logfile $logFile --url "http://127.0.0.1:$port"
exit $LASTEXITCODE

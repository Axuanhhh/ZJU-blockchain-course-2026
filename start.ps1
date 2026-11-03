param([switch]$Simulate, [switch]$OpenBrowser, [switch]$Redeploy)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$npmExe = (Get-Command npm.cmd -ErrorAction Stop).Source

function Invoke-Npm([string]$Directory, [string[]]$Arguments) {
    Push-Location $Directory
    try {
        & $npmExe @Arguments
        if ($LASTEXITCODE -ne 0) { throw "npm failed: $($Arguments -join ' ')" }
    } finally { Pop-Location }
}
function Invoke-Rpc([string]$Method, [object[]]$Params = @()) {
    $body = @{ jsonrpc = '2.0'; id = 1; method = $Method; params = $Params } | ConvertTo-Json -Compress -Depth 5
    $result = Invoke-RestMethod -Uri 'http://127.0.0.1:8545' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 3
    if ($result.error) { throw $result.error.message }
    return $result.result
}
foreach ($folder in @('contracts', 'frontend')) {
    $directory = Join-Path $projectRoot $folder
    if (-not (Test-Path -LiteralPath (Join-Path $directory 'node_modules'))) {
        Invoke-Npm $directory @('ci')
    }
}
$chainId = $null
try { $chainId = Invoke-Rpc 'eth_chainId' } catch {}
if (-not $chainId) {
    $hardhatCli = Join-Path $projectRoot 'contracts\node_modules\hardhat\dist\src\cli.js'
    $service = Start-Process -FilePath $nodeExe -ArgumentList @(('"' + $hardhatCli + '"'), 'node', '--network', 'hardhat') -WorkingDirectory (Join-Path $projectRoot 'contracts') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'chain.log') -RedirectStandardError (Join-Path $runtimeDir 'chain-error.log')
    Set-Content -LiteralPath (Join-Path $runtimeDir 'chain.pid') -Value $service.Id
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        try { $chainId = Invoke-Rpc 'eth_chainId'; break } catch {}
    }
    if (-not $chainId) { throw 'Hardhat failed to start. Check .runtime/chain-error.log and port 8545.' }
}
if ($chainId -ne '0x7a69') { throw 'Port 8545 is not the expected Hardhat chain (31337).' }
$configPath = Join-Path $projectRoot 'deployments\localhost.json'
$deployed = $false
if ((Test-Path -LiteralPath $configPath) -and -not $Redeploy) {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $code = Invoke-Rpc 'eth_getCode' @($config.dexAddress, 'latest')
    $deployed = $code -and $code -ne '0x'
}
if (-not $deployed) { Invoke-Npm (Join-Path $projectRoot 'contracts') @('run', 'deploy') }
if ($Simulate) { Invoke-Npm (Join-Path $projectRoot 'contracts') @('run', 'simulate') }
$frontendReady = $false
try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3000' -UseBasicParsing -TimeoutSec 3
    if ($response.Content -notlike '*MiniDEX*') { throw 'Port 3000 is used by another application.' }
    $frontendReady = $true
} catch {
    if ($_.Exception.Message -like '*another application*') { throw }
}
if (-not $frontendReady) {
    $viteCli = Join-Path $projectRoot 'frontend\node_modules\vite\bin\vite.js'
    $service = Start-Process -FilePath $nodeExe -ArgumentList @(('"' + $viteCli + '"'), '--host', '127.0.0.1', '--port', '3000', '--strictPort') -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'frontend.log') -RedirectStandardError (Join-Path $runtimeDir 'frontend-error.log')
    Set-Content -LiteralPath (Join-Path $runtimeDir 'frontend.pid') -Value $service.Id
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        try { $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3000' -UseBasicParsing -TimeoutSec 3; if ($response.StatusCode -eq 200) { $frontendReady = $true; break } } catch {}
    }
    if (-not $frontendReady) { throw 'Frontend failed to start. Check .runtime/frontend-error.log.' }
}
Write-Host 'MiniDEX is ready: http://127.0.0.1:3000' -ForegroundColor Green
Write-Host 'Use the local demo account selector, or connect MetaMask to chain 31337.'
Write-Host 'Stop services with: powershell -ExecutionPolicy Bypass -File .\stop.ps1'
if ($OpenBrowser) { Start-Process 'http://127.0.0.1:3000' }

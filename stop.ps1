$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
foreach ($serviceName in @('frontend', 'chain')) {
    $pidPath = Join-Path $projectRoot ('.runtime\' + $serviceName + '.pid')
    if (-not (Test-Path -LiteralPath $pidPath)) { continue }
    $servicePid = [int](Get-Content -LiteralPath $pidPath)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $servicePid"
    # A stale PID must never stop a process belonging to another project.
    if ($process -and $process.CommandLine -and $process.CommandLine.Contains($projectRoot)) {
        Stop-Process -Id $servicePid
        Write-Host "Stopped MiniDEX $serviceName ($servicePid)."
    }
}

$ErrorActionPreference = "Stop"
try {
  $slaiRuntime = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../runtime/node.exe"))
  New-NetFirewallRule -Name "SLAI-Attendance-Viewer" -DisplayName "SLAI Attendance Viewer" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 32100 -Profile Private -RemoteAddress LocalSubnet -Program $slaiRuntime | Out-Null
  Write-Host "Private LAN access enabled for viewer port 32100."
} catch {
  Write-Host "FIREWALL_SETUP_FAILED | Stage: firewall setup | Windows did not create the rule. Run this script as administrator, or check if SLAI-Attendance-Viewer already exists."
  exit 1
}

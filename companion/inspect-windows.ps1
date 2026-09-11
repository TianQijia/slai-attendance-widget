# Read-only queries. Emit fixed enums only, never adapter names, addresses or paths.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$slaiResult = @{ schemaVersion = 1; category = "Unknown"; firewall = "Unknown"; rule = "Unknown" }
try {
  $slaiAddress = Get-NetIPAddress -IPAddress $env:SLAI_DIAG_ADDRESS -AddressFamily IPv4
  $slaiProfile = @(Get-NetConnectionProfile -InterfaceIndex $slaiAddress.InterfaceIndex)[0]
  $slaiCategory = [string]$slaiProfile.NetworkCategory
  if ($slaiCategory -in @("Private", "Public", "DomainAuthenticated")) {
    $slaiResult.category = $slaiCategory
    $slaiProfileName = if ($slaiCategory -eq "DomainAuthenticated") { "Domain" } else { $slaiCategory }
    $slaiFirewall = Get-NetFirewallProfile -PolicyStore ActiveStore -Name $slaiProfileName
    if ([string]$slaiFirewall.Enabled -eq "False") { $slaiResult.firewall = "Off" }
    elseif ([string]$slaiFirewall.Enabled -eq "True") {
      $slaiResult.firewall = if ([string]$slaiFirewall.AllowInboundRules -eq "False") { "BlockAll" } else { "On" }
    }
  }
} catch { }
try {
  $slaiErrors = @()
  $slaiRules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name "SLAI-Attendance-Viewer" -ErrorAction SilentlyContinue -ErrorVariable slaiErrors)
  if ($slaiRules.Count -eq 0) {
    if (@($slaiErrors | Where-Object { [string]$_.CategoryInfo.Category -ne "ObjectNotFound" }).Count -eq 0) { $slaiResult.rule = "Missing" }
  } elseif ($slaiRules.Count -eq 1) {
    $slaiRule = $slaiRules[0]
    $slaiApp = $slaiRule | Get-NetFirewallApplicationFilter
    $slaiPort = $slaiRule | Get-NetFirewallPortFilter
    $slaiRemote = $slaiRule | Get-NetFirewallAddressFilter
    if ([string]$slaiRule.Enabled -ne "True" -or [string]$slaiRule.Action -ne "Allow") { $slaiResult.rule = "Blocked" }
    elseif ($slaiApp.Program -ine $env:SLAI_DIAG_RUNTIME) { $slaiResult.rule = "Program" }
    elseif ([string]$slaiRule.Direction -ne "Inbound" -or [string]$slaiRule.Profile -ne "Private" -or [string]$slaiPort.Protocol -notin @("TCP", "6") -or [string]$slaiPort.LocalPort -ne "32100" -or [string]$slaiRemote.RemoteAddress -ne "LocalSubnet") { $slaiResult.rule = "Scope" }
    else { $slaiResult.rule = "Ready" }
  }
} catch { }
$slaiResult | ConvertTo-Json -Compress

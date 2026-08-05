[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,

  [Parameter()]
  [string]$TaskName = 'ProjxRacing-Tegiwa-Hourly',

  [Parameter()]
  [switch]$InspectOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot 'scheduler-common.ps1')

$safeTaskName = Assert-SafeTaskName -TaskName $TaskName
$resolvedRepo = Resolve-ProjxRepoRoot -Path $RepoRoot
$runner = Resolve-SafeExistingFile -Path (Join-Path $resolvedRepo 'scripts\vendor-sync\run-hourly-tegiwa-sync.ps1') -Label 'Scheduled runner'
$expectedPowerShellExecutable = Resolve-SafeExistingFile -Path (Join-Path $PSHOME 'powershell.exe') -Label 'Windows PowerShell executable'
$expectedRunnerToken = '-File ' + (ConvertTo-WindowsCommandLineArgument -Value $runner)
$expectedRepoToken = '-RepoRoot ' + (ConvertTo-WindowsCommandLineArgument -Value $resolvedRepo)
$publishSwitchPattern = '(?i)(?:^|\s)-PublishAfterSync(?:\s|$)'
$credentialArgumentPattern = '(?i)BLOB_READ_WRITE_TOKEN|TEGIWA_STOCK_MANIFEST_SECRET|-(?:BlobReadWriteToken|ManifestSecret)\b'

if ($InspectOnly -or $WhatIfPreference) {
  if ($WhatIfPreference) {
    [void]$PSCmdlet.ShouldProcess($safeTaskName, 'Validate ownership and unregister the local hourly Tegiwa task')
  }
  [ordered]@{
    status = 'inspection_only'
    removalPerformed = $false
    taskName = $safeTaskName
    expectedExecutable = $expectedPowerShellExecutable
    expectedRunner = $runner
    expectedRepoRoot = $resolvedRepo
    acceptedPublishModes = @('local-only', 'publish-after-sync')
    credentialValuesAllowedInTaskArguments = $false
  } | ConvertTo-Json
  return
}

Import-Module ScheduledTasks -ErrorAction Stop
$task = Get-ScheduledTask -TaskName $safeTaskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
  Write-Output "Scheduled task '$safeTaskName' is already absent."
  return
}

$actions = @($task.Actions)
$actualArguments = if ($actions.Count -eq 1) { [string]$actions[0].Arguments } else { '' }
$publishSwitchCount = [regex]::Matches($actualArguments, $publishSwitchPattern).Count
$containsCredentialArgument = [regex]::IsMatch($actualArguments, $credentialArgumentPattern)
if ($actions.Count -ne 1 `
  -or -not [string]::Equals([string]$actions[0].Execute, $expectedPowerShellExecutable, [System.StringComparison]::OrdinalIgnoreCase) `
  -or [string]::IsNullOrWhiteSpace($actualArguments) `
  -or $actualArguments.IndexOf($expectedRunnerToken, [System.StringComparison]::OrdinalIgnoreCase) -lt 0 `
  -or $actualArguments.IndexOf($expectedRepoToken, [System.StringComparison]::OrdinalIgnoreCase) -lt 0 `
  -or $publishSwitchCount -gt 1 `
  -or $containsCredentialArgument) {
  throw "Task '$safeTaskName' does not match this repository's validated runner. It was not removed."
}

if ($PSCmdlet.ShouldProcess($safeTaskName, 'Unregister the validated local hourly Tegiwa task')) {
  Unregister-ScheduledTask -TaskName $safeTaskName -Confirm:$false -ErrorAction Stop
  Write-Output "Unregistered local task '$safeTaskName'. Local releases, history and health logs were retained."
}

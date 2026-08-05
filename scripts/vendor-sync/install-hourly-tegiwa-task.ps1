[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,

  [Parameter(Mandatory = $true)]
  [string]$NodeExecutable,

  [Parameter(Mandatory = $true)]
  [string]$WorkspaceRoot,

  [Parameter()]
  [string]$PrivateArchiveRoot = 'D:\Projx-Racing-Website-Data\secure-private\tegiwa\source-archives',

  [Parameter()]
  [string]$TaskName = 'ProjxRacing-Tegiwa-Hourly',

  [Parameter()]
  [ValidateRange(0, 59)]
  [int]$Minute = 15,

  [Parameter()]
  [switch]$ScheduledDryRun,

  [Parameter()]
  [switch]$PublishAfterSync,

  [Parameter()]
  [switch]$InspectOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot 'scheduler-common.ps1')

if ($ScheduledDryRun -and $PublishAfterSync) {
  throw 'Publish-after-sync cannot be combined with ScheduledDryRun because a dry-run does not promote a new local release.'
}

$safeTaskName = Assert-SafeTaskName -TaskName $TaskName
$resolvedRepo = Resolve-ProjxRepoRoot -Path $RepoRoot
$resolvedNode = Resolve-NodeExecutable -Path $NodeExecutable
$resolvedWorkspace = Resolve-TegiwaWorkspaceRoot -Path $WorkspaceRoot
$resolvedPrivateArchive = Resolve-TegiwaPrivateArchiveRoot -Path $PrivateArchiveRoot
[void](Assert-SeparateDirectoryRoots -FirstPath $resolvedPrivateArchive -SecondPath $resolvedWorkspace)
[void](Assert-SeparateDirectoryRoots -FirstPath $resolvedPrivateArchive -SecondPath $resolvedRepo)
$runner = Resolve-SafeExistingFile -Path (Join-Path $resolvedRepo 'scripts\vendor-sync\run-hourly-tegiwa-sync.ps1') -Label 'Scheduled runner'
$powerShellExecutable = Resolve-SafeExistingFile -Path (Join-Path $PSHOME 'powershell.exe') -Label 'Windows PowerShell executable'
$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if ([string]::IsNullOrWhiteSpace($currentIdentity)) {
  throw 'The current Windows identity could not be resolved.'
}

$startAt = Get-NextHourlyStart -Now (Get-Date) -Minute $Minute
$actionParts = @(
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy', 'Bypass',
  '-File', (ConvertTo-WindowsCommandLineArgument -Value $runner),
  '-RepoRoot', (ConvertTo-WindowsCommandLineArgument -Value $resolvedRepo),
  '-NodeExecutable', (ConvertTo-WindowsCommandLineArgument -Value $resolvedNode),
  '-WorkspaceRoot', (ConvertTo-WindowsCommandLineArgument -Value $resolvedWorkspace),
  '-PrivateArchiveRoot', (ConvertTo-WindowsCommandLineArgument -Value $resolvedPrivateArchive)
)
if ($ScheduledDryRun) {
  $actionParts += '-DryRun'
}
if ($PublishAfterSync) {
  $actionParts += '-PublishAfterSync'
}
$actionArguments = $actionParts -join ' '
$inspectionArguments = $actionArguments.Replace(
  (ConvertTo-WindowsCommandLineArgument -Value $resolvedPrivateArchive),
  '"<private-archive-redacted>"'
)
$publishEnvironmentStatus = if ($PublishAfterSync) {
  Get-BlobPublishEnvironmentStatus
} else {
  $null
}
$taskDescription = if ($PublishAfterSync) {
  'Local Projx Racing Tegiwa stock updater with opt-in verified Vercel Blob publication after a successful sync. No overlap; hourly at the configured minute; current-user logon catch-up.'
} else {
  'Local Projx Racing Tegiwa stock updater. No overlap; hourly at the configured minute; current-user logon catch-up.'
}

$plan = [ordered]@{
  status = 'inspection_only'
  registrationPerformed = $false
  taskName = $safeTaskName
  runAs = $currentIdentity
  logonType = 'Interactive'
  runLevel = 'Limited'
  nextHourlyStart = $startAt.ToString('o')
  minute = $Minute
  repetitionMinutes = 60
  catchUpAtCurrentUserLogon = $true
  startWhenAvailableAfterMissedRun = $true
  multipleInstances = 'IgnoreNew'
  networkRequired = $true
  privateArchiveValidated = $true
  scheduledMode = if ($ScheduledDryRun) { 'dry-run' } else { 'promote' }
  publishAfterSync = [bool]$PublishAfterSync
  publishRunsOnlyAfterSuccessfulSync = [bool]$PublishAfterSync
  publishEnvironmentReady = if ($PublishAfterSync) { [bool]$publishEnvironmentStatus.ready } else { $null }
  requiredPublishEnvironmentVariables = if ($PublishAfterSync) {
    @($publishEnvironmentStatus.requiredVariableNames)
  } else {
    @()
  }
  executable = $powerShellExecutable
  arguments = $inspectionArguments
  workingDirectory = $resolvedRepo
}

if ($InspectOnly -or $WhatIfPreference) {
  if ($WhatIfPreference) {
    [void]$PSCmdlet.ShouldProcess($safeTaskName, 'Register the validated local hourly Tegiwa task')
  }
  $plan | ConvertTo-Json -Depth 4
  return
}

if ($PublishAfterSync) {
  [void](Assert-BlobPublishEnvironment)
}

Import-Module ScheduledTasks -ErrorAction Stop
$existing = Get-ScheduledTask -TaskName $safeTaskName -ErrorAction SilentlyContinue
if ($null -ne $existing) {
  throw "A scheduled task named '$safeTaskName' already exists. It was not overwritten."
}

if ($PSCmdlet.ShouldProcess($safeTaskName, 'Register the validated local hourly Tegiwa task')) {
  $action = New-ScheduledTaskAction `
    -Execute $powerShellExecutable `
    -Argument $actionArguments `
    -WorkingDirectory $resolvedRepo
  $hourlyTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At $startAt `
    -RepetitionInterval (New-TimeSpan -Hours 1)
  $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentIdentity
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 45) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
  $principal = New-ScheduledTaskPrincipal `
    -UserId $currentIdentity `
    -LogonType Interactive `
    -RunLevel Limited
  $definition = New-ScheduledTask `
    -Action $action `
    -Trigger @($hourlyTrigger, $logonTrigger) `
    -Settings $settings `
    -Principal $principal `
    -Description $taskDescription
  Register-ScheduledTask -TaskName $safeTaskName -InputObject $definition -ErrorAction Stop | Out-Null
  Write-Output "Registered local task '$safeTaskName'. No credential, password or cloud resource was created."
}

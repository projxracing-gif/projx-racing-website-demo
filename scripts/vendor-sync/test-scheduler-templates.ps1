[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$commonPath = Join-Path $scriptRoot 'scheduler-common.ps1'
. $commonPath

function Assert-True {
  param(
    [Parameter(Mandatory = $true)]
    [bool]$Condition,

    [Parameter(Mandatory = $true)]
    [string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Throws {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Action,

    [Parameter(Mandatory = $true)]
    [string]$Message
  )
  $threw = $false
  try {
    & $Action
  } catch {
    $threw = $true
  }
  Assert-True -Condition $threw -Message $Message
}

$templateFiles = @(
  $commonPath,
  (Join-Path $scriptRoot 'install-local-workspace.ps1'),
  (Join-Path $scriptRoot 'run-hourly-tegiwa-sync.ps1'),
  (Join-Path $scriptRoot 'install-hourly-tegiwa-task.ps1'),
  (Join-Path $scriptRoot 'uninstall-hourly-tegiwa-task.ps1')
)
foreach ($file in $templateFiles) {
  $tokens = $null
  $parseErrors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$parseErrors)
  Assert-True -Condition ($parseErrors.Count -eq 0) -Message "PowerShell parser errors were found in $file."
}

Assert-True `
  -Condition ((ConvertTo-WindowsCommandLineArgument -Value 'C:\Program Files\nodejs\node.exe') -eq '"C:\Program Files\nodejs\node.exe"') `
  -Message 'Task action path quoting is incorrect.'
Assert-True `
  -Condition ((ConvertTo-WindowsCommandLineArgument -Value 'D:\safe\') -eq '"D:\safe\\"') `
  -Message 'Trailing backslashes are not escaped safely.'
Assert-Throws `
  -Action { [void](ConvertTo-WindowsCommandLineArgument -Value "unsafe`nvalue") } `
  -Message 'Newlines must be rejected from task arguments.'
Assert-Throws `
  -Action { [void](Assert-SafeDDriveWorkspacePath -FullPath 'C:\vendor-feeds\tegiwa') } `
  -Message 'A non-D: workspace must be rejected.'
Assert-Throws `
  -Action { [void](Assert-SafeDDriveWorkspacePath -FullPath 'D:\') } `
  -Message 'The D: drive root must be rejected.'

$originalBlobToken = [Environment]::GetEnvironmentVariable('BLOB_READ_WRITE_TOKEN', 'Process')
$originalManifestSecret = [Environment]::GetEnvironmentVariable('TEGIWA_STOCK_MANIFEST_SECRET', 'Process')
try {
  [Environment]::SetEnvironmentVariable('BLOB_READ_WRITE_TOKEN', $null, 'Process')
  [Environment]::SetEnvironmentVariable('TEGIWA_STOCK_MANIFEST_SECRET', $null, 'Process')
  $missingPublishEnvironment = Get-BlobPublishEnvironmentStatus
  Assert-True -Condition (-not $missingPublishEnvironment.ready) -Message 'Missing publish secrets must not be reported ready.'
  Assert-Throws `
    -Action { [void](Assert-BlobPublishEnvironment) } `
    -Message 'Missing publish secrets must fail closed.'

  $testBlobToken = 'vercel_blob_test_token_1234567890'
  $testManifestSecret = 'manifest-test-secret-1234567890-abcdef'
  [Environment]::SetEnvironmentVariable('BLOB_READ_WRITE_TOKEN', $testBlobToken, 'Process')
  [Environment]::SetEnvironmentVariable('TEGIWA_STOCK_MANIFEST_SECRET', $testManifestSecret, 'Process')
  $readyPublishEnvironment = Assert-BlobPublishEnvironment
  Assert-True -Condition $readyPublishEnvironment.ready -Message 'Valid publish environment shapes were not accepted.'
  Assert-True `
    -Condition ($readyPublishEnvironment.requiredVariableNames.Count -eq 2) `
    -Message 'The publish preflight must name exactly two required environment variables.'
  $serializedPublishStatus = $readyPublishEnvironment | ConvertTo-Json -Depth 3
  Assert-True `
    -Condition ($serializedPublishStatus -notmatch [regex]::Escape($testBlobToken) `
      -and $serializedPublishStatus -notmatch [regex]::Escape($testManifestSecret)) `
    -Message 'Publish environment status must never expose secret values.'
} finally {
  [Environment]::SetEnvironmentVariable('BLOB_READ_WRITE_TOKEN', $originalBlobToken, 'Process')
  [Environment]::SetEnvironmentVariable('TEGIWA_STOCK_MANIFEST_SECRET', $originalManifestSecret, 'Process')
}

$beforeMinute = Get-Date '2026-08-05T10:00:00'
$afterMinute = Get-Date '2026-08-05T10:16:00'
Assert-True `
  -Condition ((Get-NextHourlyStart -Now $beforeMinute -Minute 15) -eq (Get-Date '2026-08-05T10:15:00')) `
  -Message 'The next hourly start before minute 15 is incorrect.'
Assert-True `
  -Condition ((Get-NextHourlyStart -Now $afterMinute -Minute 15) -eq (Get-Date '2026-08-05T11:15:00')) `
  -Message 'The next hourly start after minute 15 is incorrect.'

$runnerText = Get-Content -LiteralPath (Join-Path $scriptRoot 'run-hourly-tegiwa-sync.ps1') -Raw
$workspaceInstallerText = Get-Content -LiteralPath (Join-Path $scriptRoot 'install-local-workspace.ps1') -Raw
$installerText = Get-Content -LiteralPath (Join-Path $scriptRoot 'install-hourly-tegiwa-task.ps1') -Raw
$uninstallerText = Get-Content -LiteralPath (Join-Path $scriptRoot 'uninstall-hourly-tegiwa-task.ps1') -Raw

Assert-True -Condition ($runnerText -match "'--download'") -Message 'The runner does not explicitly select approved-download mode.'
Assert-True -Condition ($runnerText -match "'--baseline'") -Message 'The runner does not provide a previous-good baseline.'
Assert-True -Condition ($runnerText -match "'--private-archive'") -Message 'The runner does not provide the private source archive.'
Assert-True -Condition ($runnerText -match '-VerifyOnly') -Message 'The runner does not fail closed on ACL drift.'
Assert-True -Condition ($runnerText -match '\$ValidateOnly') -Message 'The runner lacks a no-network validation mode.'
Assert-True -Condition ($runnerText -match '\$PublishAfterSync') -Message 'The runner lacks explicit publish-after-sync opt in.'
Assert-True -Condition ($runnerText -match 'Assert-BlobPublishEnvironment') -Message 'The runner does not preflight publish environment secrets.'
Assert-True -Condition ($runnerText -match 'publish-vercel-blob\.mjs') -Message 'The runner does not resolve the verified Blob publisher.'
Assert-True `
  -Condition ($runnerText -match '\$DryRun -and \$PublishAfterSync') `
  -Message 'The runner must reject publishing after a local dry-run.'
$publishEnvironmentGuardIndex = $runnerText.IndexOf('$publishEnvironmentStatus = Assert-BlobPublishEnvironment')
$syncInvocationIndex = $runnerText.IndexOf('& $resolvedNode @syncArguments')
$syncSuccessGuardIndex = $runnerText.IndexOf('if ($syncExitCode -ne 0)')
$publisherInvocationIndex = $runnerText.IndexOf('& $resolvedNode @publishArguments')
Assert-True `
  -Condition ($publishEnvironmentGuardIndex -ge 0 -and $publishEnvironmentGuardIndex -lt $syncInvocationIndex) `
  -Message 'Publish secrets must fail closed before the local sync starts.'
Assert-True `
  -Condition ($syncInvocationIndex -ge 0 -and $syncInvocationIndex -lt $syncSuccessGuardIndex `
    -and $syncSuccessGuardIndex -lt $publisherInvocationIndex) `
  -Message 'The Blob publisher must run only after a successful local sync.'
Assert-True -Condition ($installerText -match 'SupportsShouldProcess') -Message 'The installer lacks ShouldProcess support.'
Assert-True -Condition ($installerText -match 'RepetitionInterval \(New-TimeSpan -Hours 1\)') -Message 'The installer is not hourly.'
Assert-True -Condition ($installerText -match 'New-ScheduledTaskTrigger -AtLogOn') -Message 'The installer lacks current-user logon catch-up.'
Assert-True -Condition ($installerText -match '-StartWhenAvailable') -Message 'Missed-start catch-up is not enabled.'
Assert-True -Condition ($installerText -match '-MultipleInstances IgnoreNew') -Message 'No-overlap task behavior is missing.'
Assert-True -Condition ($installerText -match '-LogonType Interactive') -Message 'The task is not limited to the current interactive user.'
Assert-True -Condition ($installerText -match "'-PrivateArchiveRoot'") -Message 'The scheduled action lacks explicit private-archive wiring.'
Assert-True -Condition ($installerText -match '\$PublishAfterSync') -Message 'The installer lacks explicit publish-after-sync opt in.'
Assert-True `
  -Condition ($installerText -match '\$actionParts \+= ''-PublishAfterSync''') `
  -Message 'The installer does not pass only the publish opt-in switch to the runner.'
Assert-True `
  -Condition ($installerText -match '\$ScheduledDryRun -and \$PublishAfterSync') `
  -Message 'The installer must reject publish-after-sync for scheduled dry-runs.'
Assert-True -Condition ($installerText -match 'publishEnvironmentReady') -Message 'The inspection plan omits publish environment readiness.'
Assert-True -Condition ($installerText -match 'requiredPublishEnvironmentVariables') -Message 'The inspection plan omits required environment variable names.'
$installerEnvironmentGuardIndex = $installerText.IndexOf('[void](Assert-BlobPublishEnvironment)')
$scheduledTasksImportIndex = $installerText.IndexOf('Import-Module ScheduledTasks')
Assert-True `
  -Condition ($installerEnvironmentGuardIndex -ge 0 -and $installerEnvironmentGuardIndex -lt $scheduledTasksImportIndex) `
  -Message 'A real task registration must fail on invalid publish secrets before Task Scheduler is accessed.'
Assert-True -Condition ($installerText -match '<private-archive-redacted>') -Message 'Inspection output does not redact the private archive path.'
Assert-True -Condition ($installerText -notmatch 'New-ScheduledTaskTrigger\s+-AtStartup') -Message 'A startup trigger would exceed the no-admin template scope.'
Assert-True -Condition ($installerText -notmatch 'Register-ScheduledTask[^\r\n]*-Force') -Message 'The installer must not overwrite an existing task.'
Assert-True -Condition ($uninstallerText -match 'expectedRunnerToken') -Message 'The uninstaller lacks runner ownership validation.'
Assert-True -Condition ($uninstallerText -match 'expectedPowerShellExecutable') -Message 'The uninstaller lacks executable ownership validation.'
Assert-True -Condition ($uninstallerText -match 'publishSwitchCount') -Message 'The uninstaller does not validate the optional publish switch.'
Assert-True -Condition ($uninstallerText -match 'containsCredentialArgument') -Message 'The uninstaller does not reject credential-bearing task arguments.'
Assert-True -Condition ($uninstallerText -match 'SupportsShouldProcess') -Message 'The uninstaller lacks ShouldProcess support.'
Assert-Throws `
  -Action { [void](Assert-SeparateDirectoryRoots -FirstPath 'D:\private' -SecondPath 'D:\private\nested') } `
  -Message 'Nested private and operational roots must be rejected.'
Assert-True -Condition ($workspaceInstallerText -match '\$InspectOnly') -Message 'The workspace installer lacks inspection-only mode.'
Assert-True -Condition ($workspaceInstallerText -match '\$VerifyOnly') -Message 'The workspace installer lacks read-only ACL verification mode.'
Assert-True -Condition ($workspaceInstallerText -match 'SetAccessRuleProtection\(\$true, \$false\)') -Message 'ACL inheritance is not disabled safely.'
Assert-True -Condition ($workspaceInstallerText -match 'S-1-5-18') -Message 'The SYSTEM SID is missing from the ACL plan.'
Assert-True -Condition ($workspaceInstallerText -match 'S-1-5-32-544') -Message 'The Administrators SID is missing from the ACL plan.'
Assert-True -Condition ($workspaceInstallerText -match 'FileSystemRights\]::FullControl') -Message 'Full-control ACL rules are missing.'
Assert-True -Condition ($workspaceInstallerText -match 'Set-Acl') -Message 'The workspace installer does not apply ACLs.'
Assert-True -Condition ($workspaceInstallerText -match 'Assert-HardenedAcl') -Message 'The workspace installer does not verify applied ACLs.'
Assert-True -Condition ($workspaceInstallerText -match 'seenSids') -Message 'ACL verification does not enforce an exact, duplicate-free SID set.'
Assert-True -Condition ($workspaceInstallerText -match 'nonInteractiveSidValues') -Message 'Service identities are not rejected from desktop-user ACL setup.'
Assert-True -Condition ($workspaceInstallerText -notmatch '(?i)S-1-1-0|Builtin\\Users|Authenticated Users') -Message 'A broad ACL principal was found.'

$allTemplateText = $templateFiles.ForEach({ Get-Content -LiteralPath $_ -Raw }) -join "`n"
Assert-True `
  -Condition ($allTemplateText -notmatch '(?i)Get-Credential|ConvertTo-SecureString|LogonType\s+Password|[-]Password\b') `
  -Message 'A credential or password flow was found in the scheduler templates.'

Write-Output 'Scheduler template validation passed: syntax, quoting, D: path rules, hourly/logon triggers, no-overlap settings, opt-in post-sync publication ordering, fail-closed environment checks, ownership guard and credential exclusions.'

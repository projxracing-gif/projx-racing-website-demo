[CmdletBinding()]
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
  [switch]$DryRun,

  [Parameter()]
  [switch]$PublishAfterSync,

  [Parameter()]
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot 'scheduler-common.ps1')

if ($DryRun -and $PublishAfterSync) {
  throw 'Publish-after-sync cannot be combined with DryRun because a dry-run does not promote a new local release.'
}

$resolvedRepo = Resolve-ProjxRepoRoot -Path $RepoRoot
$resolvedNode = Resolve-NodeExecutable -Path $NodeExecutable
$resolvedWorkspace = Resolve-TegiwaWorkspaceRoot -Path $WorkspaceRoot
$resolvedPrivateArchive = Resolve-TegiwaPrivateArchiveRoot -Path $PrivateArchiveRoot
[void](Assert-SeparateDirectoryRoots -FirstPath $resolvedPrivateArchive -SecondPath $resolvedWorkspace)
[void](Assert-SeparateDirectoryRoots -FirstPath $resolvedPrivateArchive -SecondPath $resolvedRepo)
$syncScript = Resolve-SafeExistingFile -Path (Join-Path $resolvedRepo 'scripts\vendor-sync\tegiwa.mjs') -Label 'Tegiwa sync CLI'
$publisherScript = Resolve-SafeExistingFile `
  -Path (Join-Path $resolvedRepo 'scripts\vendor-sync\publish-vercel-blob.mjs') `
  -Label 'Vercel Blob publisher CLI'
$baseline = Resolve-SafeExistingFile -Path (Join-Path $resolvedRepo 'api\data\tegiwa-stock-index.json') -Label 'Tegiwa baseline index'
$aclVerifier = Resolve-SafeExistingFile `
  -Path (Join-Path $resolvedRepo 'scripts\vendor-sync\install-local-workspace.ps1') `
  -Label 'Local vendor ACL verifier'

$publishEnvironmentStatus = $null
if ($PublishAfterSync) {
  $publishEnvironmentStatus = Assert-BlobPublishEnvironment
}

$aclVerificationOutput = & $aclVerifier `
  -WorkspaceRoot $resolvedWorkspace `
  -PrivateArchiveRoot $resolvedPrivateArchive `
  -VerifyOnly
$aclVerification = ($aclVerificationOutput -join "`n") | ConvertFrom-Json
if ($aclVerification.status -ne 'acl_verified_only') {
  throw 'The local vendor ACL verifier did not return its expected success state.'
}

$syncArguments = @(
  $syncScript,
  '--workspace', $resolvedWorkspace,
  '--download',
  '--private-archive', $resolvedPrivateArchive,
  '--baseline', $baseline
)
if ($DryRun) {
  $syncArguments += '--dry-run'
}

if ($ValidateOnly) {
  [ordered]@{
    status = 'validated_only'
    networkRequestMade = $false
    repoRoot = $resolvedRepo
    nodeExecutable = $resolvedNode
    workspaceRoot = $resolvedWorkspace
    privateArchiveValidated = $true
    privateAclVerified = $true
    mode = if ($DryRun) { 'download_dry_run' } else { 'download_promote' }
    publishAfterSync = [bool]$PublishAfterSync
    publishEnvironmentReady = if ($PublishAfterSync) { [bool]$publishEnvironmentStatus.ready } else { $null }
    requiredPublishEnvironmentVariables = if ($PublishAfterSync) {
      @($publishEnvironmentStatus.requiredVariableNames)
    } else {
      @()
    }
  } | ConvertTo-Json
  return
}

Push-Location -LiteralPath $resolvedRepo
try {
  & $resolvedNode @syncArguments
  $syncExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($syncExitCode -ne 0) {
  throw "The local Tegiwa updater exited with code $syncExitCode. current.json remains governed by the updater's validation gates."
}

if ($PublishAfterSync) {
  $publishArguments = @(
    $publisherScript,
    '--workspace', $resolvedWorkspace
  )
  Push-Location -LiteralPath $resolvedRepo
  try {
    & $resolvedNode @publishArguments
    $publishExitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($publishExitCode -ne 0) {
    throw "The verified Vercel Blob publisher exited with code $publishExitCode. The local release remains available and the remote current pointer remains governed by the publisher's safeguards."
  }
}

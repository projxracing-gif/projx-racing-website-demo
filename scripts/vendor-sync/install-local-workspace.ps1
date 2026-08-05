[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Low')]
param(
  [Parameter()]
  [ValidateNotNullOrEmpty()]
  [string]$WorkspaceRoot = 'D:\Projx-Racing-Website-Data\vendor-feeds\tegiwa',

  [Parameter()]
  [ValidateNotNullOrEmpty()]
  [string]$PrivateArchiveRoot = 'D:\Projx-Racing-Website-Data\secure-private\tegiwa\source-archives',

  [Parameter()]
  [switch]$InspectOnly,

  [Parameter()]
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-SafeRoot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Label
  )
  if ([string]::IsNullOrWhiteSpace($Path) -or $Path -match '[\r\n"\x00]') {
    throw "$Label contains an unsafe value."
  }
  if (-not [System.IO.Path]::IsPathRooted($Path)) {
    throw "$Label must be an explicit absolute path."
  }
  $resolved = [System.IO.Path]::GetFullPath($Path).TrimEnd([char]92, [char]47)
  $driveRoot = [System.IO.Path]::GetPathRoot($resolved)
  if ([string]::IsNullOrWhiteSpace($driveRoot) `
    -or [string]::Equals($resolved, $driveRoot.TrimEnd([char]92, [char]47), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label cannot be a drive or filesystem root."
  }
  return $resolved
}

function Assert-SeparateRoots {
  param(
    [Parameter(Mandatory = $true)]
    [string]$First,

    [Parameter(Mandatory = $true)]
    [string]$Second
  )
  $firstPrefix = $First + [System.IO.Path]::DirectorySeparatorChar
  $secondPrefix = $Second + [System.IO.Path]::DirectorySeparatorChar
  if ([string]::Equals($First, $Second, [System.StringComparison]::OrdinalIgnoreCase) `
    -or $First.StartsWith($secondPrefix, [System.StringComparison]::OrdinalIgnoreCase) `
    -or $Second.StartsWith($firstPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The vendor workspace and private archive must use separate directory trees.'
  }
}

function Get-SafeTreeItems {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root
  )
  $items = @((Get-Item -LiteralPath $Root -Force -ErrorAction Stop))
  $items += @(Get-ChildItem -LiteralPath $Root -Force -Recurse -ErrorAction Stop)
  foreach ($item in $items) {
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'ACL hardening stopped because a symbolic link or another reparse point was found.'
    }
  }
  return $items
}

function New-HardenedAcl {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.FileSystemInfo]$Item,

    [Parameter(Mandatory = $true)]
    [System.Security.Principal.SecurityIdentifier]$OwnerSid,

    [Parameter(Mandatory = $true)]
    [System.Security.Principal.SecurityIdentifier[]]$AllowedSids
  )
  $acl = Get-Acl -LiteralPath $Item.FullName -ErrorAction Stop
  $acl.SetAccessRuleProtection($true, $false)
  $existingRules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  foreach ($rule in $existingRules) {
    [void]$acl.RemoveAccessRuleSpecific($rule)
  }
  $acl.SetOwner($OwnerSid)
  $inheritance = if ($Item.PSIsContainer) {
    [System.Security.AccessControl.InheritanceFlags]::ContainerInherit `
      -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    [System.Security.AccessControl.InheritanceFlags]::None
  }
  foreach ($sid in $AllowedSids) {
    $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule -ArgumentList @(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($accessRule)
  }
  return $acl
}

function Assert-HardenedAcl {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.FileSystemInfo]$Item,

    [Parameter(Mandatory = $true)]
    [System.Security.Principal.SecurityIdentifier]$OwnerSid,

    [Parameter(Mandatory = $true)]
    [string[]]$AllowedSidValues
  )
  $acl = Get-Acl -LiteralPath $Item.FullName -ErrorAction Stop
  if (-not $acl.AreAccessRulesProtected) {
    throw 'ACL verification failed because inherited access remains enabled.'
  }
  $actualOwner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier])
  if ($actualOwner.Value -ne $OwnerSid.Value) {
    throw 'ACL verification failed because the current desktop user is not the owner.'
  }
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne $AllowedSidValues.Count) {
    throw 'ACL verification failed because an unexpected access rule remains.'
  }
  $seenSids = @{}
  foreach ($rule in $rules) {
    $sidValue = $rule.IdentityReference.Value
    if ($seenSids.ContainsKey($sidValue) `
      -or $AllowedSidValues -notcontains $sidValue `
      -or $rule.IsInherited `
      -or $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow `
      -or (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) `
        -ne [System.Security.AccessControl.FileSystemRights]::FullControl)) {
      throw 'ACL verification failed because a rule is not one of the three approved full-control entries.'
    }
    $seenSids[$sidValue] = $true
    if ($Item.PSIsContainer) {
      $requiredInheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit `
        -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
      if (($rule.InheritanceFlags -band $requiredInheritance) -ne $requiredInheritance) {
        throw 'ACL verification failed because directory inheritance flags are incomplete.'
      }
    } elseif ($rule.InheritanceFlags -ne [System.Security.AccessControl.InheritanceFlags]::None) {
      throw 'ACL verification failed because a file contains directory inheritance flags.'
    }
  }
  foreach ($requiredSid in $AllowedSidValues) {
    if (-not $seenSids.ContainsKey($requiredSid)) {
      throw 'ACL verification failed because a required principal is missing.'
    }
  }
}

function Set-HardenedAclTree {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root,

    [Parameter(Mandatory = $true)]
    [System.Security.Principal.SecurityIdentifier]$OwnerSid,

    [Parameter(Mandatory = $true)]
    [System.Security.Principal.SecurityIdentifier[]]$AllowedSids
  )
  $items = @(Get-SafeTreeItems -Root $Root)
  foreach ($item in $items) {
    $acl = New-HardenedAcl -Item $item -OwnerSid $OwnerSid -AllowedSids $AllowedSids
    Set-Acl -LiteralPath $item.FullName -AclObject $acl -ErrorAction Stop
  }
  $verificationItems = @(Get-SafeTreeItems -Root $Root)
  if ($verificationItems.Count -ne $items.Count) {
    throw 'ACL verification failed because the protected tree changed during hardening.'
  }
  $allowedSidValues = @($AllowedSids | ForEach-Object { $_.Value })
  foreach ($item in $verificationItems) {
    Assert-HardenedAcl -Item $item -OwnerSid $OwnerSid -AllowedSidValues $allowedSidValues
  }
  return $verificationItems.Count
}

function Assert-HardenedAclTree {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root,

    [Parameter(Mandatory = $true)]
    [System.Security.Principal.SecurityIdentifier]$OwnerSid,

    [Parameter(Mandatory = $true)]
    [System.Security.Principal.SecurityIdentifier[]]$AllowedSids
  )
  $items = @(Get-SafeTreeItems -Root $Root)
  $allowedSidValues = @($AllowedSids | ForEach-Object { $_.Value })
  foreach ($item in $items) {
    Assert-HardenedAcl -Item $item -OwnerSid $OwnerSid -AllowedSidValues $allowedSidValues
  }
  return $items.Count
}

$resolvedWorkspace = Resolve-SafeRoot -Path $WorkspaceRoot -Label 'Workspace root'
$resolvedPrivateArchive = Resolve-SafeRoot -Path $PrivateArchiveRoot -Label 'Private archive root'
if (-not [string]::Equals(
  [System.IO.Path]::GetPathRoot($resolvedPrivateArchive),
  'D:\',
  [System.StringComparison]::OrdinalIgnoreCase
)) {
  throw 'The private source archive must be on D:.'
}
Assert-SeparateRoots -First $resolvedWorkspace -Second $resolvedPrivateArchive

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentUserSid = $currentIdentity.User
if ($null -eq $currentUserSid) {
  throw 'The current desktop user SID could not be resolved.'
}
$nonInteractiveSidValues = @('S-1-5-18', 'S-1-5-19', 'S-1-5-20')
if ($nonInteractiveSidValues -contains $currentUserSid.Value) {
  throw 'ACL setup must be run by the intended interactive desktop user, not a Windows service identity.'
}
$systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$administratorsSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
$allowedSids = @($currentUserSid, $systemSid, $administratorsSid)
if ($InspectOnly -and $VerifyOnly) {
  throw '-InspectOnly and -VerifyOnly cannot be combined.'
}

$plan = [ordered]@{
  status = 'inspection_only'
  changesPerformed = $false
  workspaceRoot = $resolvedWorkspace
  privateArchive = '<redacted-private-archive>'
  privateArchiveValidatedOnDrive = 'D:'
  ownerSid = $currentUserSid.Value
  allowedSids = @($allowedSids | ForEach-Object { $_.Value })
  inheritanceProtected = $true
  recursiveVerification = $true
  access = 'FullControl'
}

if ($InspectOnly -or $WhatIfPreference) {
  if ($WhatIfPreference) {
    [void]$PSCmdlet.ShouldProcess('local vendor workspace and private archive', 'Create directories and enforce verified private ACLs')
  }
  $plan | ConvertTo-Json -Depth 4
  return
}

if ($VerifyOnly) {
  $archiveItemCount = Assert-HardenedAclTree `
    -Root $resolvedPrivateArchive `
    -OwnerSid $currentUserSid `
    -AllowedSids $allowedSids
  $workspaceItemCount = Assert-HardenedAclTree `
    -Root $resolvedWorkspace `
    -OwnerSid $currentUserSid `
    -AllowedSids $allowedSids
  [ordered]@{
    status = 'acl_verified_only'
    changesPerformed = $false
    workspaceItemCount = $workspaceItemCount
    privateArchiveItemCount = $archiveItemCount
    allowedSidCount = $allowedSids.Count
  } | ConvertTo-Json
  return
}

if (-not $PSCmdlet.ShouldProcess(
  'local vendor workspace and private archive',
  'Create directories and recursively enforce and verify private ACLs'
)) {
  $plan.status = 'declined'
  $plan | ConvertTo-Json -Depth 4
  return
}

$directories = @(
  $resolvedWorkspace,
  (Join-Path $resolvedWorkspace 'incoming'),
  (Join-Path $resolvedWorkspace 'staging'),
  (Join-Path $resolvedWorkspace 'releases'),
  (Join-Path $resolvedWorkspace 'history'),
  (Join-Path $resolvedWorkspace 'health'),
  $resolvedPrivateArchive
)
foreach ($directory in $directories) {
  if (Test-Path -LiteralPath $directory) {
    $existingDirectory = Get-Item -LiteralPath $directory -Force -ErrorAction Stop
    if (-not $existingDirectory.PSIsContainer `
      -or ($existingDirectory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'A required local vendor directory is a file, symbolic link or another reparse point.'
    }
  } else {
    [void](New-Item -ItemType Directory -Path $directory -ErrorAction Stop)
  }
}

if (-not (Test-Path -LiteralPath $resolvedWorkspace -PathType Container) `
  -or -not (Test-Path -LiteralPath $resolvedPrivateArchive -PathType Container)) {
  throw 'Required local vendor directories were not created; ACL hardening stopped.'
}

$archiveItemCount = Set-HardenedAclTree -Root $resolvedPrivateArchive -OwnerSid $currentUserSid -AllowedSids $allowedSids
$workspaceItemCount = Set-HardenedAclTree -Root $resolvedWorkspace -OwnerSid $currentUserSid -AllowedSids $allowedSids

[ordered]@{
  status = 'prepared_and_acl_verified'
  workspaceItemCount = $workspaceItemCount
  privateArchiveItemCount = $archiveItemCount
  ownerSid = $currentUserSid.Value
  allowedSidCount = $allowedSids.Count
  inheritanceProtected = $true
} | ConvertTo-Json

Write-Output 'No scheduled task, network connection, credential, cloud resource, deployment, or repository change was created.'

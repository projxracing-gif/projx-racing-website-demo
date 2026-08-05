Set-StrictMode -Version Latest

function Assert-SafeSchedulerText {
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value,

    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$Label cannot be empty."
  }
  if ($Value.IndexOf([char]0) -ge 0 -or $Value -match '[\r\n"]') {
    throw "$Label contains a character that is unsafe in a scheduled-task argument."
  }
  return $Value
}

function Resolve-SafeExistingFile {
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  $safePath = Assert-SafeSchedulerText -Value $Path -Label $Label
  if (-not [System.IO.Path]::IsPathRooted($safePath)) {
    throw "$Label must be an explicit absolute path."
  }
  $fullPath = [System.IO.Path]::GetFullPath($safePath)
  $item = Get-Item -LiteralPath $fullPath -Force -ErrorAction Stop
  if ($item.PSIsContainer) {
    throw "$Label must identify a file."
  }
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "$Label cannot be a symbolic link or another reparse point."
  }
  return $item.FullName
}

function Resolve-SafeExistingDirectory {
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  $safePath = Assert-SafeSchedulerText -Value $Path -Label $Label
  if (-not [System.IO.Path]::IsPathRooted($safePath)) {
    throw "$Label must be an explicit absolute path."
  }
  $fullPath = [System.IO.Path]::GetFullPath($safePath)
  $item = Get-Item -LiteralPath $fullPath -Force -ErrorAction Stop
  if (-not $item.PSIsContainer) {
    throw "$Label must identify a directory."
  }
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "$Label cannot be a symbolic link or another reparse point."
  }
  return $item.FullName.TrimEnd([char]92, [char]47)
}

function Assert-SafeDDriveWorkspacePath {
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory = $true)]
    [string]$FullPath
  )

  $safePath = Assert-SafeSchedulerText -Value $FullPath -Label 'Workspace root'
  if (-not [System.IO.Path]::IsPathRooted($safePath)) {
    throw 'Workspace root must be an explicit absolute path.'
  }
  $normalized = [System.IO.Path]::GetFullPath($safePath).TrimEnd([char]92, [char]47)
  $driveRoot = [System.IO.Path]::GetPathRoot($normalized)
  if (-not [string]::Equals($driveRoot, 'D:\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The scheduled vendor workspace must be on the D: drive.'
  }
  if ([string]::Equals($normalized, 'D:', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The D: drive root cannot be used as the vendor workspace.'
  }
  return $normalized
}

function Resolve-TegiwaWorkspaceRoot {
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $directory = Resolve-SafeExistingDirectory -Path $Path -Label 'Workspace root'
  return Assert-SafeDDriveWorkspacePath -FullPath $directory
}

function Resolve-TegiwaPrivateArchiveRoot {
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $directory = Resolve-SafeExistingDirectory -Path $Path -Label 'Private archive root'
  return Assert-SafeDDriveWorkspacePath -FullPath $directory
}

function Assert-SeparateDirectoryRoots {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$FirstPath,

    [Parameter(Mandatory = $true)]
    [string]$SecondPath
  )

  $first = [System.IO.Path]::GetFullPath($FirstPath).TrimEnd([char]92, [char]47)
  $second = [System.IO.Path]::GetFullPath($SecondPath).TrimEnd([char]92, [char]47)
  $firstPrefix = $first + [System.IO.Path]::DirectorySeparatorChar
  $secondPrefix = $second + [System.IO.Path]::DirectorySeparatorChar
  if ([string]::Equals($first, $second, [System.StringComparison]::OrdinalIgnoreCase) `
    -or $first.StartsWith($secondPrefix, [System.StringComparison]::OrdinalIgnoreCase) `
    -or $second.StartsWith($firstPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The private archive, vendor workspace and repository must use separate directory trees.'
  }
}

function Resolve-ProjxRepoRoot {
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $root = Resolve-SafeExistingDirectory -Path $Path -Label 'Repository root'
  $requiredFiles = @(
    'package.json',
    'scripts\vendor-sync\install-local-workspace.ps1',
    'scripts\vendor-sync\publish-vercel-blob.mjs',
    'scripts\vendor-sync\tegiwa.mjs',
    'scripts\vendor-sync\run-hourly-tegiwa-sync.ps1',
    'scripts\build-tegiwa-stock-index.mjs',
    'api\data\tegiwa-stock-index.json'
  )
  foreach ($relativePath in $requiredFiles) {
    [void](Resolve-SafeExistingFile -Path (Join-Path $root $relativePath) -Label "Required repository file '$relativePath'")
  }
  return $root
}

function Get-RequiredBlobPublishEnvironmentVariableNames {
  [CmdletBinding()]
  [OutputType([string[]])]
  param()

  return @(
    'BLOB_READ_WRITE_TOKEN',
    'TEGIWA_STOCK_MANIFEST_SECRET'
  )
}

function Get-BlobPublishEnvironmentStatus {
  [CmdletBinding()]
  [OutputType([pscustomobject])]
  param()

  $blobToken = [Environment]::GetEnvironmentVariable('BLOB_READ_WRITE_TOKEN', 'Process')
  $manifestSecret = [Environment]::GetEnvironmentVariable('TEGIWA_STOCK_MANIFEST_SECRET', 'Process')
  $blobTokenValid = $null -ne $blobToken `
    -and $blobToken.Length -ge 20 `
    -and $blobToken.Length -le 4096 `
    -and [string]::Equals($blobToken, $blobToken.Trim(), [System.StringComparison]::Ordinal)
  $manifestSecretBytes = if ($null -eq $manifestSecret) {
    0
  } else {
    [System.Text.Encoding]::UTF8.GetByteCount($manifestSecret)
  }
  $manifestSecretValid = $null -ne $manifestSecret `
    -and -not [string]::IsNullOrWhiteSpace($manifestSecret) `
    -and $manifestSecretBytes -ge 32 `
    -and $manifestSecretBytes -le 1024

  return [pscustomobject][ordered]@{
    requiredVariableNames = @(Get-RequiredBlobPublishEnvironmentVariableNames)
    blobTokenValid = [bool]$blobTokenValid
    manifestSecretValid = [bool]$manifestSecretValid
    ready = [bool]($blobTokenValid -and $manifestSecretValid)
  }
}

function Assert-BlobPublishEnvironment {
  [CmdletBinding()]
  [OutputType([pscustomobject])]
  param()

  $status = Get-BlobPublishEnvironmentStatus
  if (-not $status.ready) {
    $invalidNames = @()
    if (-not $status.blobTokenValid) {
      $invalidNames += 'BLOB_READ_WRITE_TOKEN'
    }
    if (-not $status.manifestSecretValid) {
      $invalidNames += 'TEGIWA_STOCK_MANIFEST_SECRET'
    }
    throw "Publish-after-sync is enabled, but required server-only environment configuration is missing or invalid: $($invalidNames -join ', '). No sync or publish was started."
  }
  return $status
}

function Resolve-NodeExecutable {
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $nodePath = Resolve-SafeExistingFile -Path $Path -Label 'Node executable'
  if (-not [string]::Equals([System.IO.Path]::GetFileName($nodePath), 'node.exe', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Node executable must resolve to a file named node.exe.'
  }
  return $nodePath
}

function Assert-SafeTaskName {
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory = $true)]
    [string]$TaskName
  )

  if ($TaskName -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$') {
    throw 'Task name must contain only letters, numbers, dots, underscores or hyphens and be at most 64 characters.'
  }
  return $TaskName
}

function ConvertTo-WindowsCommandLineArgument {
  [CmdletBinding()]
  [OutputType([string])]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $safeValue = Assert-SafeSchedulerText -Value $Value -Label 'Task action value'
  $trailingBackslashes = 0
  for ($index = $safeValue.Length - 1; $index -ge 0 -and $safeValue[$index] -eq [char]92; $index -= 1) {
    $trailingBackslashes += 1
  }
  $escapedTail = if ($trailingBackslashes -gt 0) { '\' * $trailingBackslashes } else { '' }
  return '"' + $safeValue + $escapedTail + '"'
}

function Get-NextHourlyStart {
  [CmdletBinding()]
  [OutputType([datetime])]
  param(
    [Parameter(Mandatory = $true)]
    [datetime]$Now,

    [Parameter(Mandatory = $true)]
    [ValidateRange(0, 59)]
    [int]$Minute
  )

  $candidate = $Now.Date.AddHours($Now.Hour).AddMinutes($Minute)
  if ($candidate -le $Now) {
    $candidate = $candidate.AddHours(1)
  }
  return $candidate
}

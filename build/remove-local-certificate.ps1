param([Parameter(Mandatory = $true)][string]$CertDirectory)

$ErrorActionPreference = 'Stop'
$currentUserRoots = 'HKCU:\Software\Microsoft\SystemCertificates\Root\Certificates'
if (!(Test-Path -LiteralPath $currentUserRoots)) { exit 0 }
$fingerprints = @{}
$active = Join-Path $CertDirectory 'aurapro-lan.cert.pem'
$paths = @(Get-Item -LiteralPath $active -ErrorAction SilentlyContinue)
$paths += @(Get-ChildItem -LiteralPath (Join-Path $CertDirectory 'trusted') -File -Filter '*.pem' -ErrorAction SilentlyContinue)
if (!$paths.Count) { exit 0 }

$sha = [Security.Cryptography.SHA256]::Create()
$store = [Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser')
try {
  foreach ($file in $paths) {
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
    $pem = [IO.File]::ReadAllText($file.FullName).Trim()
    if ($pem -notmatch '\A-----BEGIN CERTIFICATE-----\s+([A-Za-z0-9+/=\r\n]+)\s+-----END CERTIFICATE-----\z') { continue }
    try {
      $der = [Convert]::FromBase64String($Matches[1])
      $cert = [Security.Cryptography.X509Certificates.X509Certificate2]::new($der)
    } catch { continue }
    try {
      if ($cert.Subject -cne 'O=AuraPro, CN=AuraPro Local Network' -or $cert.Issuer -cne $cert.Subject) { continue }
      $hash = [BitConverter]::ToString($sha.ComputeHash($cert.RawData)).Replace('-', '')
      if ($file.FullName -ne $active -and $file.Name -cne "$hash.pem") { continue }
      $fingerprints[$hash] = $true
    } finally { $cert.Dispose() }
  }
  if (!$fingerprints.Count) { exit 0 }

  $store.Open([Security.Cryptography.X509Certificates.OpenFlags]'ReadWrite,OpenExistingOnly')
  foreach ($cert in $store.Certificates) {
    $hash = [BitConverter]::ToString($sha.ComputeHash($cert.RawData)).Replace('-', '')
    if ($fingerprints.ContainsKey($hash) -and (Test-Path -LiteralPath (Join-Path $currentUserRoots $cert.Thumbprint))) {
      $store.Remove($cert)
    }
  }
} finally {
  $store.Close()
  $sha.Dispose()
}

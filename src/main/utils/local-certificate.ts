import { execFile } from 'child_process'
import { X509Certificate } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { readFile, readdir, rm, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'

const CERTIFICATE_NICKNAME = 'AuraPro Local HTTPS'
const COMMAND_TIMEOUT_MS = 60_000

interface CommandResult {
  stdout: string
  stderr: string
}

export interface LocalCertificateInstallResult {
  success: boolean
  platform: NodeJS.Platform
  error?: string
  restartBrowser?: boolean
  warning?: string
}

const activeCertificateName = 'aurapro-lan.cert.pem'
const receiptDirectoryName = 'trusted'
const managedSubject = ['CN=AuraPro Local Network', 'O=AuraPro']
const pemPattern = /^-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\r\n]+\s+-----END CERTIFICATE-----$/
let certificateOperation = Promise.resolve()

const withCertificateLock = <T>(run: () => Promise<T>): Promise<T> => {
  const result = certificateOperation.then(run)
  certificateOperation = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

export const localCertificatePath = (userData: string): string =>
  join(userData, 'certs', activeCertificateName)

const readLocalCertificate = async (path: string) => {
  const pem = (await readFile(path, 'ascii')).trim()
  const cert = new X509Certificate(pem)
  if (
    !pemPattern.test(pem) ||
    !cert.checkIssued(cert) ||
    !cert.verify(cert.publicKey) ||
    cert.subject.split('\n').sort().join('\n') !== managedSubject.join('\n')
  )
    throw new Error('Not an AuraPro local HTTPS certificate.')
  return { pem: cert.toString(), fingerprint: cert.fingerprint256.replaceAll(':', ''), path }
}

type LocalCertificate = Awaited<ReturnType<typeof readLocalCertificate>>

const saveCertificateReceipt = async (active: LocalCertificate): Promise<LocalCertificate> => {
  const directory = join(dirname(active.path), receiptDirectoryName)
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `${active.fingerprint}.pem`)
  await writeFile(path, active.pem, { mode: 0o600, flag: 'wx' }).catch((error) => {
    if (error.code !== 'EEXIST') throw error
  })
  const saved = await readLocalCertificate(path)
  if (saved.fingerprint !== active.fingerprint)
    throw new Error('Certificate record does not match the current certificate.')
  return saved
}

const certificateReceipts = async (path: string): Promise<LocalCertificate[]> => {
  const directory = join(dirname(path), receiptDirectoryName)
  if (!existsSync(directory)) return []
  const receipts: LocalCertificate[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[A-F0-9]{64}\.pem$/.test(entry.name)) continue
    const certificate = await readLocalCertificate(join(directory, entry.name)).catch(() => null)
    if (certificate && `${certificate.fingerprint}.pem` === entry.name) receipts.push(certificate)
  }
  return receipts
}

const runCommand = (command: string, args: string[]): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          const details = [error.message, stderr].filter(Boolean).join('\n').trim()
          reject(new Error(details || 'Command failed: ' + command))
          return
        }
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
      }
    )
  })

const windowsSystemTool = (...parts: string[]): string =>
  join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', ...parts)

const installOnWindows = async (certificate: LocalCertificate): Promise<void> => {
  // Windows indexes the trust store by the certificate hash, not the file name.
  await runCommand(windowsSystemTool('certutil.exe'), [
    '-user',
    '-addstore',
    '-f',
    'Root',
    certificate.path
  ])
}

const macKeychain = async (): Promise<string> => {
  const { stdout } = await runCommand('/usr/bin/security', ['default-keychain', '-d', 'user'])
  return (
    stdout.trim().replace(/^"|"$/g, '') ||
    join(homedir(), 'Library', 'Keychains', 'login.keychain-db')
  )
}

const installOnMacOS = async (certificate: LocalCertificate): Promise<void> => {
  await runCommand('/usr/bin/security', [
    'add-trusted-cert',
    '-r',
    'trustRoot',
    '-p',
    'ssl',
    '-k',
    await macKeychain(),
    certificate.path
  ])
}

const nssDatabase = () => join(homedir(), '.pki', 'nssdb')
const nssNickname = ({ fingerprint }: LocalCertificate) => `${CERTIFICATE_NICKNAME} ${fingerprint}`

const nssHasCertificate = async (
  args: string[],
  certificate: LocalCertificate
): Promise<boolean> => {
  const result = await runCommand('certutil', ['-L', ...args, '-a']).catch((error: Error) => {
    if (/SEC_ERROR_UNKNOWN_CERT|Could not find cert/i.test(error.message)) return null
    throw error
  })
  return result !== null && new X509Certificate(result.stdout).toString() === certificate.pem
}

const installOnLinux = async (certificate: LocalCertificate): Promise<void> => {
  const directory = nssDatabase()
  mkdirSync(directory, { recursive: true })
  const databaseArg = 'sql:' + directory

  if (!existsSync(join(directory, 'cert9.db'))) {
    await runCommand('certutil', ['-N', '-d', databaseArg, '--empty-password'])
  }

  // NSS can keep the old nickname when the exact same certificate is imported again.
  const legacy = ['-d', databaseArg, '-n', CERTIFICATE_NICKNAME]
  if (await nssHasCertificate(legacy, certificate)) {
    await runCommand('certutil', ['-M', ...legacy, '-t', 'P,,'])
    return
  }

  await runCommand('certutil', [
    '-A',
    '-d',
    databaseArg,
    '-n',
    nssNickname(certificate),
    '-t',
    'P,,',
    '-i',
    certificate.path
  ])
}

const removeFromLinux = async (certificate: LocalCertificate): Promise<void> => {
  const directory = nssDatabase()
  if (!existsSync(join(directory, 'cert9.db'))) return
  const database = ['-d', 'sql:' + directory]
  for (const nickname of [nssNickname(certificate), CERTIFICATE_NICKNAME]) {
    const args = [...database, '-n', nickname]
    if (await nssHasCertificate(args, certificate)) {
      await runCommand('certutil', ['-D', ...args])
    }
  }
}

const removeFromStore = async (certificate: LocalCertificate): Promise<void> => {
  if (process.platform === 'win32') {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$store = [Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser')",
      '$sha = [Security.Cryptography.SHA256]::Create()',
      "$root = 'HKCU:\\Software\\Microsoft\\SystemCertificates\\Root\\Certificates'",
      'try { if (!(Test-Path -LiteralPath $root)) { exit 0 }; $store.Open("ReadWrite,OpenExistingOnly"); foreach ($cert in $store.Certificates) {',
      '  $hash = [BitConverter]::ToString($sha.ComputeHash($cert.RawData)).Replace("-", "")',
      `  if ($hash -eq '${certificate.fingerprint}' -and (Test-Path -LiteralPath (Join-Path $root $cert.Thumbprint))) { $store.Remove($cert) }`,
      '} } finally { $store.Close(); $sha.Dispose() }'
    ]
    await runCommand(windowsSystemTool('WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script.join('\n')
    ])
  } else if (process.platform === 'darwin') {
    const keychain = await macKeychain()
    const login = join(homedir(), 'Library', 'Keychains', 'login.keychain-db')
    for (const location of new Set([keychain, login])) {
      if (!existsSync(location)) continue
      try {
        await runCommand('/usr/bin/security', [
          'delete-certificate',
          '-t',
          '-Z',
          certificate.fingerprint,
          location
        ])
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/could not be found|unable to delete certificate matching/i.test(error.message)
        )
          throw error
      }
    }
  } else if (process.platform === 'linux') {
    await removeFromLinux(certificate)
  }
}

const removeTrackedCertificates = async (certificatePath: string, keep?: string): Promise<void> => {
  const certificates = await certificateReceipts(certificatePath)
  // Older versions did not record installs. The exact active certificate remains safe to match.
  if (!keep && existsSync(certificatePath)) {
    const active = await readLocalCertificate(certificatePath).catch(() => null)
    if (active && !certificates.some(({ fingerprint }) => fingerprint === active.fingerprint))
      certificates.push(active)
  }
  for (const certificate of certificates) {
    if (certificate.fingerprint === keep) continue
    await removeFromStore(certificate)
    if (certificate.path !== certificatePath) await rm(certificate.path, { force: true })
  }
}

const removeLocalCertificateUnlocked = async (
  certificatePath: string
): Promise<LocalCertificateInstallResult> => {
  const platform = process.platform
  try {
    if (!['win32', 'darwin', 'linux'].includes(platform))
      return {
        success: false,
        platform,
        error: `Certificate removal is not supported on ${platform}.`
      }
    await removeTrackedCertificates(certificatePath)
    return { success: true, platform, restartBrowser: true }
  } catch (error) {
    return {
      success: false,
      platform,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

const installLocalCertificateUnlocked = async (
  certificatePath: string
): Promise<LocalCertificateInstallResult> => {
  const platform = process.platform

  if (!existsSync(certificatePath)) {
    return {
      success: false,
      platform,
      error:
        'The local HTTPS certificate was not found. Start the local WebUI service and try again.'
    }
  }

  try {
    const certificate = await saveCertificateReceipt(await readLocalCertificate(certificatePath))

    if (platform === 'win32') {
      await installOnWindows(certificate)
    } else if (platform === 'darwin') {
      await installOnMacOS(certificate)
    } else if (platform === 'linux') {
      await installOnLinux(certificate)
    } else {
      return {
        success: false,
        platform,
        error: 'Installing a local certificate is not supported on ' + platform + '.'
      }
    }

    const result: LocalCertificateInstallResult = { success: true, platform, restartBrowser: true }
    try {
      await removeTrackedCertificates(certificatePath, certificate.fingerprint)
    } catch (error) {
      result.warning = error instanceof Error ? error.message : String(error)
    }
    return result
  } catch (error) {
    return {
      success: false,
      platform,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export const installLocalCertificate = (certificatePath: string) =>
  withCertificateLock(() => installLocalCertificateUnlocked(certificatePath))

export const removeLocalCertificate = (certificatePath: string) =>
  withCertificateLock(() => removeLocalCertificateUnlocked(certificatePath))

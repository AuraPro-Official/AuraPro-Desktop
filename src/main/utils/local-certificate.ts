import { execFile } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

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

const installOnWindows = async (certificatePath: string): Promise<void> => {
  const certutilPath = join(
    process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows',
    'System32',
    'certutil.exe'
  )
  await runCommand(certutilPath, ['-user', '-addstore', '-f', 'Root', certificatePath])
}

const installOnMacOS = async (certificatePath: string): Promise<void> => {
  const { stdout } = await runCommand('/usr/bin/security', ['default-keychain', '-d', 'user'])
  const loginKeychain =
    stdout.trim().replace(/^"|"$/g, '') ||
    join(homedir(), 'Library', 'Keychains', 'login.keychain-db')

  await runCommand('/usr/bin/security', [
    'add-trusted-cert',
    '-r',
    'trustRoot',
    '-p',
    'ssl',
    '-k',
    loginKeychain,
    certificatePath
  ])
}

const installOnLinux = async (certificatePath: string): Promise<void> => {
  const nssDatabase = join(homedir(), '.pki', 'nssdb')
  mkdirSync(nssDatabase, { recursive: true })
  const databaseArg = 'sql:' + nssDatabase

  if (!existsSync(join(nssDatabase, 'cert9.db'))) {
    await runCommand('certutil', ['-N', '-d', databaseArg, '--empty-password'])
  }

  await runCommand('certutil', ['-D', '-d', databaseArg, '-n', CERTIFICATE_NICKNAME]).catch(
    () => undefined
  )
  await runCommand('certutil', [
    '-A',
    '-d',
    databaseArg,
    '-n',
    CERTIFICATE_NICKNAME,
    '-t',
    'P,,',
    '-i',
    certificatePath
  ])
}

export const installLocalCertificate = async (
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
    if (platform === 'win32') {
      await installOnWindows(certificatePath)
    } else if (platform === 'darwin') {
      await installOnMacOS(certificatePath)
    } else if (platform === 'linux') {
      await installOnLinux(certificatePath)
    } else {
      return {
        success: false,
        platform,
        error: 'Installing a local certificate is not supported on ' + platform + '.'
      }
    }

    return { success: true, platform, restartBrowser: true }
  } catch (error) {
    return {
      success: false,
      platform,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

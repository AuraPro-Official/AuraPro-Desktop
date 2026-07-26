import { autoUpdater, type UpdateInfo } from 'electron-updater'
import log from 'electron-log'
import { app, BrowserWindow, dialog, Notification, shell } from 'electron'
import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { join } from 'path'

import {
  checkOfficialGlossaryUpdate,
  type OfficialGlossaryUpdateCheckResult
} from './utils/official-glossaries'

let mainWin: BrowserWindow | null = null
let promptedVersion: string | null = null
let installAfterDownload = false
let latestUpdateInfo: UpdateInfo | null = null
let downloadedMacDmgPath: string | null = null
let glossaryUpdateCheckInFlight: Promise<OfficialGlossaryUpdateCheckResult> | null = null
let notifiedGlossaryVersion: string | null = null

const GITHUB_RELEASE_BASE_URL =
  'https://github.com/AuraPro-Official/AuraPro-Desktop/releases/download'

const send = (type: string, data?: unknown): void => {
  mainWin?.webContents.send('main:data', { type, data })
}

const checkInstalledGlossaryUpdate = async (): Promise<void> => {
  const check =
    glossaryUpdateCheckInFlight ??
    checkOfficialGlossaryUpdate().finally(() => {
      glossaryUpdateCheckInFlight = null
    })
  glossaryUpdateCheckInFlight = check

  const result = await check
  send('official-glossaries:update-check-complete', result)

  if (
    !result.updateAvailable ||
    !result.currentVersion ||
    !result.latestVersion ||
    notifiedGlossaryVersion === result.latestVersion
  ) {
    return
  }

  notifiedGlossaryVersion = result.latestVersion
  send('official-glossaries:update-available', result)

  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: '官方词典可更新',
    body: `已安装 ${result.currentVersion}，最新版本为 ${result.latestVersion}。请在“设置 → 词典”中输入测试授权码更新。`
  })
  notification.on('click', () => {
    mainWin?.show()
    mainWin?.focus()
    send('settings:open', { tab: 'glossaries' })
  })
  notification.show()
}

const decodeHtmlEntities = (text: string): string =>
  text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const named: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' '
    }
    const key = String(entity).toLowerCase()
    if (key in named) return named[key]
    if (key.startsWith('#x')) {
      const codePoint = Number.parseInt(key.slice(2), 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    if (key.startsWith('#')) {
      const codePoint = Number.parseInt(key.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    return match
  })

const cleanupReleaseNoteText = (value: string): string => {
  const headingMap: Record<string, string> = {
    added: '新增',
    changed: '优化',
    fixed: '修复',
    security: '安全',
    removed: '移除',
    deprecated: '废弃',
    'known issues': '已知问题'
  }

  const text = decodeHtmlEntities(value)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|section|article|ul|ol)\s*>/gi, '\n')
    .replace(/<\s*h[1-6][^>]*>/gi, '\n')
    .replace(/<\s*\/\s*h[1-6]\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\s*\/\s*li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')

  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, lines) => line || lines[index - 1])
    .map((line) => {
      const normalized = line.replace(/^#+\s*/, '').trim()
      const translated = headingMap[normalized.toLowerCase()]
      return translated ? `${translated}:` : line
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const formatReleaseNotes = (info: UpdateInfo): string => {
  const notes = info.releaseNotes
  if (Array.isArray(notes)) {
    const text = notes
      .map((item) => item.note ?? '')
      .filter(Boolean)
      .join('\n\n')
    return cleanupReleaseNoteText(text)
  }
  if (typeof notes === 'string') return cleanupReleaseNoteText(notes)
  return ''
}

const macUpdateArch = (): 'arm64' | 'x64' => (process.arch === 'arm64' ? 'arm64' : 'x64')

const findMacDmgUrl = (info: UpdateInfo): string => {
  const files = Array.isArray(info.files) ? info.files : []
  const dmgFile = files.find((file) => file.url.toLowerCase().endsWith('.dmg'))
  const candidate = dmgFile?.url ?? ''
  if (candidate.startsWith('http://') || candidate.startsWith('https://')) return candidate

  const arch = macUpdateArch()
  return `${GITHUB_RELEASE_BASE_URL}/v${info.version}/aurapro-${arch}.dmg`
}

const removeIfExists = (filepath: string): void => {
  try {
    if (existsSync(filepath)) unlinkSync(filepath)
  } catch {
    // Ignore stale cache cleanup failures; the following write will surface real errors.
  }
}

const downloadFile = (
  url: string,
  destination: string,
  onProgress: (progress: {
    percent: number
    bytesPerSecond: number
    transferred: number
    total: number
  }) => void,
  redirectCount = 0
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (redirectCount > 8) {
      reject(new Error('Too many redirects while downloading update'))
      return
    }

    const parsed = new URL(url)
    const request = parsed.protocol === 'http:' ? httpRequest : httpsRequest
    const req = request(
      parsed,
      {
        headers: {
          'User-Agent': 'AuraPro Desktop Updater',
          Accept: 'application/octet-stream'
        }
      },
      (response) => {
        const statusCode = response.statusCode ?? 0
        const location = response.headers.location

        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume()
          const nextUrl = new URL(location, url).toString()
          downloadFile(nextUrl, destination, onProgress, redirectCount + 1).then(resolve, reject)
          return
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume()
          reject(new Error(`Download failed with HTTP ${statusCode}`))
          return
        }

        const total = Number(response.headers['content-length'] ?? 0)
        const startedAt = Date.now()
        let transferred = 0
        const output = createWriteStream(destination)

        response.on('data', (chunk: Buffer) => {
          transferred += chunk.length
          const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.1)
          onProgress({
            percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
            bytesPerSecond: transferred / elapsedSeconds,
            transferred,
            total
          })
        })

        output.on('error', (error) => {
          response.destroy()
          reject(error)
        })
        output.on('finish', () => {
          output.close((error) => {
            if (error) reject(error)
            else resolve()
          })
        })
        response.pipe(output)
      }
    )

    req.on('error', reject)
    req.end()
  })

const openMacDmgAndQuit = async (dmgPath: string): Promise<void> => {
  send('update:installing')
  const openError = await shell.openPath(dmgPath)
  if (openError) throw new Error(openError)

  setTimeout(() => {
    app.quit()
  }, 800)
}

const promptToInstallMacDmg = async (info: UpdateInfo, dmgPath: string): Promise<void> => {
  if (!mainWin) {
    await openMacDmgAndQuit(dmgPath)
    return
  }

  const { response } = await dialog.showMessageBox(mainWin, {
    type: 'info',
    title: 'AuraPro 更新已下载',
    message: `AuraPro ${info.version} 已下载完成`,
    detail: '软件将关闭并打开安装器。请在打开的窗口中将 AuraPro 拖入 Applications 完成更新。',
    buttons: ['打开安装器并退出', '稍后手动安装'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })

  if (response === 0) {
    await openMacDmgAndQuit(dmgPath)
  }
}

const downloadMacDmgUpdate = async (info: UpdateInfo): Promise<void> => {
  const downloadUrl = findMacDmgUrl(info)
  const updateDir = join(app.getPath('userData'), 'updates')
  mkdirSync(updateDir, { recursive: true })

  const arch = macUpdateArch()
  const finalPath = join(updateDir, `AuraPro-${info.version}-${arch}.dmg`)
  const partialPath = `${finalPath}.download`
  removeIfExists(partialPath)

  send('update:download-started', { version: info.version })
  log.info(`Downloading macOS DMG update from ${downloadUrl}`)

  try {
    await downloadFile(downloadUrl, partialPath, (progress) => {
      send('update:download-progress', progress)
    })
    removeIfExists(finalPath)
    renameSync(partialPath, finalPath)
    downloadedMacDmgPath = finalPath
    send('update:downloaded', { path: finalPath })
    await promptToInstallMacDmg(info, finalPath)
  } catch (error) {
    removeIfExists(partialPath)
    throw error
  }
}

const promptForUpdate = async (info: UpdateInfo): Promise<void> => {
  if (!mainWin || promptedVersion === info.version) return
  promptedVersion = info.version

  const releaseNotes = formatReleaseNotes(info)
  const detail = [
    `发现新版本：${info.version}`,
    '',
    '更新日志',
    releaseNotes?.trim() || '暂无更新日志。'
  ].join('\n')

  const { response } = await dialog.showMessageBox(mainWin, {
    type: 'info',
    title: '发现 AuraPro 新版本',
    message: `AuraPro ${info.version} 可用，是否现在更新？`,
    detail,
    buttons: ['是，立即更新', '否，稍后再说'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })

  if (response !== 0) {
    send('update:declined', { version: info.version })
    return
  }

  if (process.platform === 'darwin') {
    downloadMacDmgUpdate(info).catch((error) => {
      log.warn('macOS DMG update download failed:', error)
      send('update:error', { message: error?.message ?? 'Update download failed' })
    })
    return
  }

  installAfterDownload = true
  send('update:download-started', { version: info.version })
  autoUpdater.downloadUpdate().catch((error) => {
    installAfterDownload = false
    log.warn('Update download failed:', error)
    send('update:error', { message: error?.message ?? 'Update download failed' })
  })
}

export function initUpdater(window: BrowserWindow): void {
  mainWin = window

  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    send('update:checking')
    void checkInstalledGlossaryUpdate().catch((error) => {
      log.warn('Official glossary update check failed unexpectedly:', error)
    })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    latestUpdateInfo = info
    send('update:available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: formatReleaseNotes(info)
    })
    promptForUpdate(info).catch((error) => {
      log.warn('Failed to prompt for update:', error)
      send('update:error', { message: error?.message ?? 'Failed to prompt for update' })
    })
  })

  autoUpdater.on('update-not-available', (_info: UpdateInfo) => {
    send('update:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    send('update:download-progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (_info: UpdateInfo) => {
    send('update:downloaded')
    if (installAfterDownload) {
      installAfterDownload = false
      send('update:installing')
      setTimeout(() => {
        autoUpdater.quitAndInstall(false, true)
      }, 500)
    }
  })

  autoUpdater.on('error', (error: Error) => {
    send('update:error', { message: error?.message ?? 'Update error' })
  })

  // Auto-check on launch (silently, only when packaged)
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn('Auto update check failed:', err)
    })
  }
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    log.info('Skipping update check — app is not packaged')
    send('update:not-available')
    return
  }
  await autoUpdater.checkForUpdates()
}

export async function downloadUpdate(): Promise<void> {
  if (process.platform === 'darwin') {
    if (!latestUpdateInfo) throw new Error('No macOS update is available to download')
    await downloadMacDmgUpdate(latestUpdateInfo)
    return
  }
  await autoUpdater.downloadUpdate()
}

export function installUpdate(): void {
  if (process.platform === 'darwin') {
    if (downloadedMacDmgPath) {
      openMacDmgAndQuit(downloadedMacDmgPath).catch((error) => {
        log.warn('Failed to open downloaded macOS DMG:', error)
        send('update:error', { message: error?.message ?? 'Failed to open update installer' })
      })
      return
    }
    send('update:error', { message: 'No downloaded macOS installer found' })
    return
  }
  autoUpdater.quitAndInstall(false, true)
}

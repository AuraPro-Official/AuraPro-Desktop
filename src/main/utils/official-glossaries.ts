import { createHash } from 'crypto'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import log from 'electron-log'

import { getOpenWebUIDataPath } from './index'

const PACKAGE_ID = 'aurapro-official-glossaries'
const INSTALLED_MANIFEST_NAME = 'official-glossaries.manifest.json'
const DEFAULT_MANIFEST_URL = 'https://aurapro.xmray.de/manifest.json'
const DEFAULT_UPDATE_METADATA_URL = 'https://aurapro.xmray.de/version.json'
const DEFAULT_BASIC_AUTH_USERNAME = 'aurapro'
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024
const MAX_UPDATE_METADATA_BYTES = 64 * 1024
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_PACKAGE_BYTES = 500 * 1024 * 1024
const MAX_FILE_COUNT = 200

export interface OfficialGlossaryFile {
  id: string
  name: string
  filename: string
  url: string
  version: string
  source_lang: string
  glossary_lang: string
  target_lang: string
  size: number
  sha256: string
}

export interface OfficialGlossaryManifest {
  schemaVersion: 1
  id: typeof PACKAGE_ID
  version: string
  publishedAt?: string
  installedAt?: string
  files: OfficialGlossaryFile[]
}

export interface OfficialGlossaryStatus {
  installed: boolean
  version: string | null
  fileCount: number
  healthy: boolean
  missingFiles: string[]
  corruptedFiles: string[]
  latestVersion: string | null
  updateAvailable: boolean
  updateCheckedAt: string | null
}

export interface OfficialGlossaryUpdateResult {
  installed: boolean
  updated: boolean
  previousVersion: string | null
  version: string
  fileCount: number
}

export interface OfficialGlossaryUpdateCheckResult {
  installed: boolean
  checked: boolean
  currentVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  checkedAt: string
}

interface OfficialGlossaryUpdateMetadata {
  schemaVersion: 1
  id: typeof PACKAGE_ID
  version: string
  publishedAt?: string
}

let lastUpdateCheck: OfficialGlossaryUpdateCheckResult | null = null

const getManifestUrl = (): string =>
  process.env.AURAPRO_GLOSSARY_MANIFEST_URL?.trim() || DEFAULT_MANIFEST_URL

const getUpdateMetadataUrl = (): string =>
  process.env.AURAPRO_GLOSSARY_UPDATE_URL?.trim() || DEFAULT_UPDATE_METADATA_URL

const getBasicAuthUsername = (): string =>
  process.env.AURAPRO_GLOSSARY_USERNAME?.trim() || DEFAULT_BASIC_AUTH_USERNAME

const getInstalledManifestPath = (): string =>
  path.join(getOpenWebUIDataPath(), INSTALLED_MANIFEST_NAME)

const isVersion = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)

const compareVersions = (left: string, right: string): number => {
  const parse = (version: string): { core: number[]; prerelease: string[] } => {
    const withoutBuild = version.split('+', 1)[0]
    const [core, prerelease = ''] = withoutBuild.split('-', 2)
    return {
      core: core.split('.').map((part) => Number(part)),
      prerelease: prerelease ? prerelease.split('.') : []
    }
  }

  const leftVersion = parse(left)
  const rightVersion = parse(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = leftVersion.core[index] - rightVersion.core[index]
    if (difference !== 0) return difference
  }

  if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length > 0) return 1
  if (leftVersion.prerelease.length > 0 && rightVersion.prerelease.length === 0) return -1

  const count = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length)
  for (let index = 0; index < count; index += 1) {
    const leftPart = leftVersion.prerelease[index]
    const rightPart = rightVersion.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue

    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart)
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftPart.localeCompare(rightPart)
  }
  return 0
}

const safeFilename = (value: unknown): value is string =>
  typeof value === 'string' &&
  value === path.basename(value) &&
  /^glossary_[a-z0-9_]+\.json$/i.test(value)

const ensureDownloadUrlIsSafe = (url: URL): void => {
  if (url.username || url.password) {
    throw new Error('The glossary download URL must not contain credentials.')
  }

  if (url.protocol === 'https:') return

  const allowInsecure =
    process.env.AURAPRO_GLOSSARY_ALLOW_INSECURE_HTTP === '1' && url.protocol === 'http:'
  if (!allowInsecure) {
    throw new Error('The official glossary server must use HTTPS.')
  }
}

const validateManifest = (value: unknown): OfficialGlossaryManifest => {
  if (!value || typeof value !== 'object') {
    throw new Error('The official glossary manifest is invalid.')
  }

  const manifest = value as Partial<OfficialGlossaryManifest>
  if (
    manifest.schemaVersion !== 1 ||
    manifest.id !== PACKAGE_ID ||
    !isVersion(manifest.version) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0 ||
    manifest.files.length > MAX_FILE_COUNT
  ) {
    throw new Error('The official glossary manifest has an unsupported format.')
  }

  const ids = new Set<string>()
  const filenames = new Set<string>()
  let packageBytes = 0

  for (const rawFile of manifest.files) {
    const file = rawFile as Partial<OfficialGlossaryFile>
    if (
      typeof file.id !== 'string' ||
      file.id.length === 0 ||
      typeof file.name !== 'string' ||
      file.name.length === 0 ||
      !safeFilename(file.filename) ||
      typeof file.url !== 'string' ||
      file.url.length === 0 ||
      !isVersion(file.version) ||
      typeof file.source_lang !== 'string' ||
      typeof file.glossary_lang !== 'string' ||
      typeof file.target_lang !== 'string' ||
      !Number.isSafeInteger(file.size) ||
      Number(file.size) <= 0 ||
      Number(file.size) > MAX_FILE_BYTES ||
      !isSha256(file.sha256)
    ) {
      throw new Error('The official glossary manifest contains an invalid file entry.')
    }

    if (ids.has(file.id) || filenames.has(file.filename)) {
      throw new Error('The official glossary manifest contains duplicate files.')
    }
    ids.add(file.id)
    filenames.add(file.filename)
    packageBytes += Number(file.size)
  }

  if (packageBytes > MAX_PACKAGE_BYTES) {
    throw new Error('The official glossary package is larger than the allowed limit.')
  }

  return manifest as OfficialGlossaryManifest
}

const validateUpdateMetadata = (value: unknown): OfficialGlossaryUpdateMetadata => {
  if (!value || typeof value !== 'object') {
    throw new Error('The official glossary update metadata is invalid.')
  }

  const metadata = value as Partial<OfficialGlossaryUpdateMetadata>
  if (metadata.schemaVersion !== 1 || metadata.id !== PACKAGE_ID || !isVersion(metadata.version)) {
    throw new Error('The official glossary update metadata has an unsupported format.')
  }

  return metadata as OfficialGlossaryUpdateMetadata
}

const authHeaders = (password: string): Record<string, string> => ({
  Authorization: `Basic ${Buffer.from(`${getBasicAuthUsername()}:${password}`, 'utf8').toString('base64')}`,
  Accept: 'application/json'
})

const fetchProtected = async (
  url: URL,
  password: string,
  accept = 'application/json'
): Promise<Response> => {
  ensureDownloadUrlIsSafe(url)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: {
        ...authHeaders(password),
        Accept: accept
      },
      signal: AbortSignal.timeout(60_000)
    })
  } catch (error) {
    log.warn(`Official glossary request failed for ${url.origin}:`, error)
    throw new Error('无法连接官方词典服务器，请检查网络或稍后重试。')
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error('测试授权码无效或当前没有测试资格。')
  }
  if (!response.ok) {
    throw new Error(`词典服务器返回错误：HTTP ${response.status}`)
  }
  return response
}

const fetchRemoteManifest = async (
  password: string
): Promise<{ manifest: OfficialGlossaryManifest; manifestUrl: URL }> => {
  if (!password) throw new Error('请输入官方词典测试授权码。')

  const manifestUrl = new URL(getManifestUrl())
  const response = await fetchProtected(manifestUrl, password)
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_MANIFEST_BYTES) {
    throw new Error('The official glossary manifest is too large.')
  }

  const raw = await response.arrayBuffer()
  if (raw.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('The official glossary manifest is too large.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw).toString('utf8'))
  } catch {
    throw new Error('词典服务器返回的版本清单不是有效的 JSON。')
  }

  return { manifest: validateManifest(parsed), manifestUrl }
}

const readInstalledManifest = async (): Promise<OfficialGlossaryManifest | null> => {
  try {
    const raw = await readFile(getInstalledManifestPath(), 'utf8')
    return validateManifest(JSON.parse(raw))
  } catch (error) {
    if (existsSync(getInstalledManifestPath())) {
      log.warn('Failed to read installed official glossary manifest:', error)
    }
    return null
  }
}

export const getInstalledOfficialGlossaryVersion = async (): Promise<string | null> =>
  (await readInstalledManifest())?.version ?? null

const fetchUpdateMetadata = async (): Promise<OfficialGlossaryUpdateMetadata> => {
  const metadataUrl = new URL(getUpdateMetadataUrl())
  ensureDownloadUrlIsSafe(metadataUrl)

  const response = await fetch(metadataUrl, {
    method: 'GET',
    redirect: 'error',
    cache: 'no-store',
    headers: {
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(15_000)
  })

  if (!response.ok) {
    throw new Error(`Official glossary update metadata returned HTTP ${response.status}.`)
  }

  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_UPDATE_METADATA_BYTES) {
    throw new Error('The official glossary update metadata is too large.')
  }

  const raw = await response.arrayBuffer()
  if (raw.byteLength > MAX_UPDATE_METADATA_BYTES) {
    throw new Error('The official glossary update metadata is too large.')
  }

  return validateUpdateMetadata(JSON.parse(Buffer.from(raw).toString('utf8')))
}

const sha256 = (value: Buffer): string => createHash('sha256').update(value).digest('hex')

const writeJsonAtomically = async (target: string, value: unknown): Promise<void> => {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  const backup = `${target}.${process.pid}.${Date.now()}.bak`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  let movedExisting = false
  try {
    if (existsSync(target)) {
      await rename(target, backup)
      movedExisting = true
    }
    await rename(temporary, target)
    await rm(backup, { force: true })
  } catch (error) {
    await rm(temporary, { force: true })
    if (movedExisting && !existsSync(target) && existsSync(backup)) {
      await rename(backup, target)
    }
    throw error
  }
}

export const getOfficialGlossaryStatus = async (): Promise<OfficialGlossaryStatus> => {
  const manifest = await readInstalledManifest()
  if (!manifest) {
    return {
      installed: false,
      version: null,
      fileCount: 0,
      healthy: true,
      missingFiles: [],
      corruptedFiles: [],
      latestVersion: null,
      updateAvailable: false,
      updateCheckedAt: null
    }
  }

  const dataDir = getOpenWebUIDataPath()
  const missingFiles: string[] = []
  const corruptedFiles: string[] = []

  await Promise.all(
    manifest.files.map(async (file) => {
      const target = path.join(dataDir, file.filename)
      try {
        const fileStat = await stat(target)
        if (fileStat.size !== file.size) {
          corruptedFiles.push(file.filename)
          return
        }
        const raw = await readFile(target)
        if (sha256(raw) !== file.sha256.toLowerCase()) {
          corruptedFiles.push(file.filename)
        }
      } catch {
        missingFiles.push(file.filename)
      }
    })
  )

  return {
    installed: true,
    version: manifest.version,
    fileCount: manifest.files.length,
    healthy: missingFiles.length === 0 && corruptedFiles.length === 0,
    missingFiles: missingFiles.sort(),
    corruptedFiles: corruptedFiles.sort(),
    latestVersion: lastUpdateCheck?.installed ? lastUpdateCheck.latestVersion : null,
    updateAvailable: lastUpdateCheck?.installed ? lastUpdateCheck.updateAvailable : false,
    updateCheckedAt: lastUpdateCheck?.installed ? lastUpdateCheck.checkedAt : null
  }
}

export const checkOfficialGlossaryUpdate = async (): Promise<OfficialGlossaryUpdateCheckResult> => {
  const installedManifest = await readInstalledManifest()
  const checkedAt = new Date().toISOString()

  if (!installedManifest) {
    lastUpdateCheck = {
      installed: false,
      checked: false,
      currentVersion: null,
      latestVersion: null,
      updateAvailable: false,
      checkedAt
    }
    return lastUpdateCheck
  }

  try {
    const metadata = await fetchUpdateMetadata()
    lastUpdateCheck = {
      installed: true,
      checked: true,
      currentVersion: installedManifest.version,
      latestVersion: metadata.version,
      updateAvailable: compareVersions(metadata.version, installedManifest.version) > 0,
      checkedAt
    }
  } catch (error) {
    log.warn('Failed to check for official glossary updates:', error)
    lastUpdateCheck = {
      installed: true,
      checked: false,
      currentVersion: installedManifest.version,
      latestVersion: null,
      updateAvailable: false,
      checkedAt
    }
  }

  return lastUpdateCheck
}

export const installOfficialGlossaries = async (
  rawPassword: string,
  onProgress?: (message: string) => void
): Promise<OfficialGlossaryUpdateResult> => {
  const password = String(rawPassword ?? '')
  if (!password.trim() || password.length > 512) {
    throw new Error('请输入有效的官方词典测试授权码。')
  }
  const previousManifest = await readInstalledManifest()
  onProgress?.('正在验证测试授权码并检查官方词典版本…')
  const { manifest, manifestUrl } = await fetchRemoteManifest(password)
  const installedStatus = await getOfficialGlossaryStatus()
  const packageUnchanged =
    previousManifest?.version === manifest.version &&
    installedStatus.healthy &&
    previousManifest.files.length === manifest.files.length &&
    previousManifest.files.every((oldFile) => {
      const currentFile = manifest.files.find((file) => file.filename === oldFile.filename)
      return currentFile?.sha256.toLowerCase() === oldFile.sha256.toLowerCase()
    })

  if (packageUnchanged) {
    onProgress?.(`官方词典已经是最新版本 ${manifest.version}`)
    return {
      installed: true,
      updated: false,
      previousVersion: previousManifest.version,
      version: manifest.version,
      fileCount: manifest.files.length
    }
  }

  const stagingDir = await mkdtemp(path.join(tmpdir(), 'aurapro-glossaries-'))
  const backupDir = path.join(stagingDir, 'backup')
  const dataDir = getOpenWebUIDataPath()
  const replacedFiles: string[] = []

  try {
    await mkdir(backupDir, { recursive: true })
    await mkdir(dataDir, { recursive: true })

    for (let index = 0; index < manifest.files.length; index += 1) {
      const file = manifest.files[index]
      onProgress?.(`正在下载官方词典 ${index + 1}/${manifest.files.length}：${file.name}`)
      const fileUrl = new URL(file.url, manifestUrl)
      if (fileUrl.origin !== manifestUrl.origin) {
        throw new Error('The glossary manifest contains a cross-origin download URL.')
      }

      const response = await fetchProtected(fileUrl, password, 'application/json')
      const raw = Buffer.from(await response.arrayBuffer())
      if (raw.byteLength !== file.size || sha256(raw) !== file.sha256.toLowerCase()) {
        throw new Error(`词典文件校验失败：${file.name}`)
      }

      try {
        const parsed = JSON.parse(raw.toString('utf8'))
        if (!parsed || (typeof parsed !== 'object' && !Array.isArray(parsed))) {
          throw new Error('Unsupported JSON root')
        }
      } catch {
        throw new Error(`词典文件不是有效的 JSON：${file.name}`)
      }

      await writeFile(path.join(stagingDir, file.filename), raw)
    }

    onProgress?.('正在安装并校验官方词典…')
    for (const file of manifest.files) {
      const target = path.join(dataDir, file.filename)
      const backup = path.join(backupDir, file.filename)
      if (existsSync(target)) {
        await copyFile(target, backup)
      }

      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
      replacedFiles.push(file.filename)
      try {
        await copyFile(path.join(stagingDir, file.filename), temporary)
        await rm(target, { force: true })
        await rename(temporary, target)
      } finally {
        await rm(temporary, { force: true })
      }
    }

    const installedManifest: OfficialGlossaryManifest = {
      ...manifest,
      installedAt: new Date().toISOString()
    }
    await writeJsonAtomically(getInstalledManifestPath(), installedManifest)
    lastUpdateCheck = {
      installed: true,
      checked: true,
      currentVersion: manifest.version,
      latestVersion: manifest.version,
      updateAvailable: false,
      checkedAt: new Date().toISOString()
    }

    const currentFilenames = new Set(manifest.files.map((file) => file.filename))
    for (const oldFile of previousManifest?.files ?? []) {
      if (!currentFilenames.has(oldFile.filename)) {
        try {
          await rm(path.join(dataDir, oldFile.filename), { force: true })
        } catch (error) {
          log.warn(`Failed to remove obsolete official glossary ${oldFile.filename}:`, error)
        }
      }
    }

    onProgress?.(`官方词典 ${manifest.version} 安装完成`)
    return {
      installed: true,
      updated: true,
      previousVersion: previousManifest?.version ?? null,
      version: manifest.version,
      fileCount: manifest.files.length
    }
  } catch (error) {
    for (const filename of replacedFiles) {
      const target = path.join(dataDir, filename)
      const backup = path.join(backupDir, filename)
      try {
        if (existsSync(backup)) {
          await copyFile(backup, target)
        } else {
          await rm(target, { force: true })
        }
      } catch (rollbackError) {
        log.error(`Failed to roll back official glossary ${filename}:`, rollbackError)
      }
    }
    throw error
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

export const uninstallOfficialGlossaries = async (): Promise<boolean> => {
  const manifest = await readInstalledManifest()
  if (!manifest) return false

  const dataDir = getOpenWebUIDataPath()
  for (const file of manifest.files) {
    await rm(path.join(dataDir, file.filename), { force: true })
  }
  await rm(getInstalledManifestPath(), { force: true })
  lastUpdateCheck = null
  return true
}

import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'

const packageName = (entry: string) =>
  /^([a-z0-9][a-z0-9_.]*)-\d[\w.+!-]*\.dist-info$/i
    .exec(entry)?.[1]
    .toLowerCase()
    .replace(/[_.]+/g, '-')

const fileInfo = (file: string) =>
  lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })

const isInside = (root: string, candidate: string) => {
  const rel = relative(root, candidate)
  return Boolean(rel) && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

const readRecords = async (site: string) =>
  (await readdir(site, { withFileTypes: true })).flatMap((entry) => {
    const name = entry.isDirectory() && !entry.isSymbolicLink() && packageName(entry.name)
    return name ? [{ original: join(site, entry.name), name }] : []
  })

const isBroken = async (directory: string): Promise<boolean> => {
  const metadata = await fileInfo(join(directory, 'METADATA'))
  if (!metadata || (metadata.isFile() && metadata.size === 0)) return true
  if (!metadata.isFile()) return false

  const record = await fileInfo(join(directory, 'RECORD'))
  if (record && !(record.isFile() && record.size === 0)) return false
  // A missing RECORD is only damage here if a wheel installer that writes it owns the package.
  const installer = join(directory, 'INSTALLER')
  const owner = await fileInfo(installer)
  return Boolean(
    owner?.isFile() &&
    owner.size <= 64 &&
    /^(?:uv|pip)\s*$/i.test(await readFile(installer, 'utf8'))
  )
}

export const withRepairedPythonPackageMetadata = async <T>(
  pythonRoot: string,
  siteDirectories: string[],
  install: () => Promise<T>,
  onBackedUp: (packages: string[], backupPath: string) => void
): Promise<T> => {
  const rootInfo = await fileInfo(pythonRoot)
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) return install()
  const root = await realpath(pythonRoot)
  const sites = new Set<string>()
  for (const candidate of siteDirectories) {
    const info = await fileInfo(candidate)
    if (!info?.isDirectory() || info.isSymbolicLink()) continue
    const site = await realpath(candidate)
    if (isInside(root, site) && basename(site) === 'site-packages') sites.add(site)
  }

  const broken: Awaited<ReturnType<typeof readRecords>> = []
  for (const site of sites) {
    for (const record of await readRecords(site)) {
      if (await isBroken(record.original)) broken.push(record)
    }
  }
  if (!broken.length) return install()

  const backupPath = await mkdtemp(join(root, '.package-metadata-backup-'))
  const moved: ((typeof broken)[number] & { backup: string })[] = []
  let installationStarted = false
  const restoreUnreplaced = async () => {
    const restoreErrors: unknown[] = []
    for (const { original, name, backup } of moved) {
      try {
        if (await fileInfo(original)) continue
        if (installationStarted) {
          const replacements = (await readRecords(dirname(original))).filter(
            (entry) => entry.name === name
          )
          let repaired = false
          for (const replacement of replacements) {
            if (!(await isBroken(replacement.original))) {
              repaired = true
              break
            }
          }
          if (repaired) continue
        }
        await rename(backup, original)
      } catch (error) {
        restoreErrors.push(error)
      }
    }
    if (restoreErrors.length)
      throw new AggregateError(
        restoreErrors,
        `Unable to restore package records from ${backupPath}`
      )
  }

  let result: T
  try {
    for (const record of broken) {
      const directory = join(backupPath, String(moved.length))
      await mkdir(directory)
      const backup = join(directory, basename(record.original))
      await rename(record.original, backup)
      moved.push({ ...record, backup })
    }
    onBackedUp([...new Set(moved.map(({ name }) => name))], backupPath)
    installationStarted = true
    result = await install()
  } catch (error) {
    try {
      await restoreUnreplaced()
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], `${error}\n${restoreError}`)
    }
    throw error
  }
  await restoreUnreplaced()
  return result
}

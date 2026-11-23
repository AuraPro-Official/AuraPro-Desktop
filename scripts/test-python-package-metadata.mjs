import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { withRepairedPythonPackageMetadata } from '../src/main/utils/python-package-metadata.ts'

const environment = async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'aurapro-test-metadata-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const root = join(home, 'python')
  const site = join(root, 'Lib', 'site-packages')
  await mkdir(site, { recursive: true })
  const dist = async (distribution, files, directory = site) => {
    const folder = join(directory, `${distribution}.dist-info`)
    await mkdir(folder)
    for (const [name, value] of Object.entries(files)) await writeFile(join(folder, name), value)
    return folder
  }
  return { home, root, site, dist }
}

const complete = { METADATA: 'Name: test\nVersion: 1.0\n', RECORD: 'METADATA,,', INSTALLER: 'uv' }

test('moves multiple broken records once and preserves healthy and unrelated packages and data', async (t) => {
  const { home, root, site, dist } = await environment(t)
  const onnx = await dist('onnxruntime-1.26.0', { RECORD: 'METADATA,,' })
  const charset = await dist('charset_normalizer-3.5.2', {
    METADATA: 'Name: charset-normalizer',
    INSTALLER: 'pip\n'
  })
  const optional = await dist('unused-1.0', { METADATA: '' })
  const managedElsewhere = await dist('vendor-1.0', { METADATA: 'Name: vendor' })
  const healthy = await dist('healthy-1.0', complete)
  const chat = join(home, 'chat.db')
  const module = join(site, 'onnxruntime')
  await writeFile(chat, 'data')
  await mkdir(module)
  await writeFile(join(module, 'module.pyd'), 'binary')
  let backupPath

  assert.equal(
    await withRepairedPythonPackageMetadata(
      root,
      [site, site],
      async () => {
        for (const file of [onnx, charset, optional])
          await assert.rejects(stat(file), { code: 'ENOENT' })
        assert.ok((await stat(healthy)).isDirectory())
        assert.ok((await stat(managedElsewhere)).isDirectory())
        await dist('onnxruntime-1.26.0', complete)
        await dist('charset_normalizer-3.5.3', complete)
        return 'installed'
      },
      (names, backup) => {
        assert.deepEqual(names.sort(), ['charset-normalizer', 'onnxruntime', 'unused'])
        backupPath = backup
      }
    ),
    'installed'
  )
  assert.ok((await stat(onnx)).isDirectory())
  await assert.rejects(stat(charset), { code: 'ENOENT' })
  assert.equal(await readFile(join(optional, 'METADATA'), 'utf8'), '')
  assert.equal(await readFile(chat, 'utf8'), 'data')
  assert.equal(await readFile(join(module, 'module.pyd'), 'utf8'), 'binary')
  assert.ok((await readdir(backupPath)).length > 0)
})

test('network failure restores unreplaced records without overwriting completed repairs', async (t) => {
  const { root, site, dist } = await environment(t)
  const first = await dist('first-1.0', {})
  const second = await dist('second-1.0', {})
  await assert.rejects(
    withRepairedPythonPackageMetadata(
      root,
      [site],
      async () => {
        await dist('first-1.0', complete)
        throw new Error('Connection timed out')
      },
      () => {}
    ),
    /Connection timed out/
  )
  assert.equal(await readFile(join(first, 'METADATA'), 'utf8'), complete.METADATA)
  assert.ok((await stat(second)).isDirectory())
})

test('does not move records outside bundled Python', async (t) => {
  const { home, root, site, dist } = await environment(t)
  const external = join(home, 'external', 'site-packages')
  await mkdir(external, { recursive: true })
  const untouched = await dist('system-1.0', {}, external)
  await withRepairedPythonPackageMetadata(
    root,
    [site, external],
    async () => {
      assert.ok((await stat(untouched)).isDirectory())
    },
    assert.fail
  )
})

test('does not follow directory links', async (t) => {
  const { home, root, site, dist } = await environment(t)
  const external = join(home, 'external', 'site-packages')
  await mkdir(external, { recursive: true })
  const untouched = await dist('system-1.0', {}, external)
  const linkedRecord = join(site, 'linked-1.0.dist-info')
  const linkedSite = join(root, 'site-packages')
  try {
    await symlink(untouched, linkedRecord, 'junction')
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error
    t.skip('Directory link creation is blocked by the test environment')
    return
  }
  await symlink(external, linkedSite, 'junction')
  await withRepairedPythonPackageMetadata(
    root,
    [site, external, linkedSite],
    async () => {
      assert.ok((await stat(untouched)).isDirectory())
      assert.ok((await stat(linkedRecord)).isDirectory())
    },
    assert.fail
  )
})

test(
  'bundled ensurepip restores pip in an isolated environment with no packages',
  { skip: !process.env.AURAPRO_TEST_PYTHON },
  async (t) => {
    const { home } = await environment(t)
    const venv = join(home, 'test-venv')
    execFileSync(process.env.AURAPRO_TEST_PYTHON, ['-IB', '-m', 'venv', '--without-pip', venv])
    const python = join(
      venv,
      process.platform === 'win32' ? 'Scripts' : 'bin',
      process.platform === 'win32' ? 'python.exe' : 'python'
    )
    const run = (...args) =>
      execFileSync(python, ['-IB', '-m', ...args], { encoding: 'utf8', stdio: 'pipe' })
    assert.throws(() => run('pip', '--version'), /No module named pip/)
    run('ensurepip', '--upgrade')
    assert.match(run('pip', '--version'), /^pip /)
  }
)

test(
  'uv reinstalls two damaged dependencies in an offline installation',
  { skip: !process.env.AURAPRO_TEST_UV },
  async (t) => {
    const { home, root, site } = await environment(t)
    const wheels = join(home, 'wheels')
    await mkdir(wheels)
    execFileSync(process.env.AURAPRO_TEST_PYTHON ?? 'python', [
      '-IS',
      '-c',
      `
from pathlib import Path
import sys, zipfile
for name, requirements in [('test_webui', ['test_onnx', 'test_charset']), ('test_onnx', []), ('test_charset', [])]:
    directory = f'{name}-1.0.dist-info'
    with zipfile.ZipFile(Path(sys.argv[1]) / f'{name}-1.0-py3-none-any.whl', 'w') as wheel:
        metadata = f'Metadata-Version: 2.1\\nName: {name}\\nVersion: 1.0\\n'
        metadata += ''.join(f'Requires-Dist: {dep}==1.0\\n' for dep in requirements)
        wheel.writestr(f'{directory}/METADATA', metadata)
        wheel.writestr(f'{directory}/WHEEL', 'Wheel-Version: 1.0\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')
        files = [*wheel.namelist(), f'{name}.py', f'{directory}/RECORD']
        wheel.writestr(f'{name}.py', 'value = 1\\n')
        wheel.writestr(f'{directory}/RECORD', ''.join(f'{entry},,\\n' for entry in files))
`,
      wheels
    ])
    const install = async () => {
      execFileSync(
        process.env.AURAPRO_TEST_UV,
        [
          '--no-config',
          'pip',
          'install',
          '--no-cache',
          '--offline',
          '--no-index',
          '--find-links',
          'wheels',
          '--target',
          site,
          'test-webui==1.0'
        ],
        { cwd: home, stdio: 'pipe' }
      )
    }
    await install()
    const onnxMetadata = join(site, 'test_onnx-1.0.dist-info', 'METADATA')
    const charsetRecord = join(site, 'test_charset-1.0.dist-info', 'RECORD')
    await rm(onnxMetadata)
    await rm(charsetRecord)
    await assert.rejects(install, /test_onnx-1\.0\.dist-info[\\/]METADATA/)
    await withRepairedPythonPackageMetadata(root, [site], install, (names) => {
      assert.deepEqual(names.sort(), ['test-charset', 'test-onnx'])
    })
    assert.match(await readFile(onnxMetadata, 'utf8'), /Version: 1.0/)
    assert.match(await readFile(charsetRecord, 'utf8'), /test_charset\.py/)
  }
)

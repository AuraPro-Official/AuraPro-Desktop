import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import {
  HIGH_Q4_DOWNLOAD,
  INDEX_TRANSLATE_MODELS,
  localModelUpgradeNotice
} from '../src/shared/index-translate-models.ts'
import * as upgradeFiles from '../src/main/utils/model-upgrade-files.ts'
import { writeDownloadBody } from '../src/main/utils/download-stream.ts'

const installed = (filename, size, repo = filename.slice(0, -5)) => ({ filename, size, repo })

test('only known old revisions of same-name Index models trigger an upgrade', () => {
  const { name, previous, current } = INDEX_TRANSLATE_MODELS.medium
  assert.equal(localModelUpgradeNotice([installed(name, previous.expectedSize)])?.kind, 'revision')
  assert.equal(
    localModelUpgradeNotice([installed(name, previous.expectedSize, 'Local')])?.kind,
    'revision'
  )
  assert.equal(localModelUpgradeNotice([installed(name, current.expectedSize)]), null)
  assert.equal(localModelUpgradeNotice([installed(name, 100)]), null)
  assert.equal(localModelUpgradeNotice([installed('custom-model.gguf', 100)]), null)
})

test('known pre-QAT model revisions are distinguished from custom GGUFs', () => {
  const target = HIGH_Q4_DOWNLOAD
  const file = installed(target.name, 100)
  const old = {
    ...file,
    sourceRepo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    sourceFilename: 'gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf'
  }
  assert.equal(localModelUpgradeNotice([old])?.kind, 'revision')
  assert.equal(localModelUpgradeNotice([file]), null)
  assert.equal(localModelUpgradeNotice([{ ...old, sourceRepo: target.hfRepo }]), null)
  assert.equal(localModelUpgradeNotice([installed('lowest.gguf', 100)])?.to, 'lowest_V2.gguf')
})

test('retired standard models show a mapped alternative, but not after it is installed', () => {
  const old = installed('medium_Q4.gguf', 100)
  const { name, current } = INDEX_TRANSLATE_MODELS.medium
  assert.equal(localModelUpgradeNotice([old])?.to, name)
  assert.equal(localModelUpgradeNotice([old, installed(name, current.expectedSize)]), null)
  const oldCode = installed('high-code_Q4.gguf', 100)
  assert.equal(localModelUpgradeNotice([oldCode])?.kind, 'pro')
  assert.equal(localModelUpgradeNotice([oldCode], true), null)
  assert.equal(localModelUpgradeNotice([oldCode, old], true)?.to, name)
})

function loadFunction(file, name, globals) {
  const filename = new URL(`../src/main/${file}`, import.meta.url)
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (item) =>
      (ts.isFunctionDeclaration(item) && item.name?.text === name) ||
      (ts.isVariableStatement(item) &&
        item.declarationList.declarations.some((decl) => decl.name.getText(source) === name))
  )
  assert.ok(declaration, name)
  return vm.runInNewContext(
    ts.transpileModule(`${declaration.getText(source).replace(/^export /, '')}\n${name}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText,
    globals
  )
}

for (const [kind, outcome] of [
  ['replacement', 'ok'],
  ['same-name', 'ok'],
  ['same-name', 'download-fault'],
  ['replacement', 'bad-header'],
  ['same-name', 'move-fault'],
  ['same-name', 'not-listed']
]) {
  test(`model upgrade preserves the old bundle until activation (${kind}, ${outcome})`, async (t) => {
    const root = fs.mkdtempSync(path.join(tmpdir(), 'aurapro-model-switch-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const sameName = kind === 'same-name'
    const name = sameName ? HIGH_Q4_DOWNLOAD.name : 'lowest.gguf'
    const newName = sameName ? name : INDEX_TRANSLATE_MODELS.lowest.name
    const newRepo = newName.slice(0, -5)
    const repo = name.slice(0, -5)
    const previous = path.join(root, repo, name)
    const previousProjector = path.join(root, repo, 'mmproj-F16.gguf')
    const final = path.join(root, newRepo, newName)
    fs.mkdirSync(path.dirname(previous))
    fs.writeFileSync(previous, 'previous model')
    fs.writeFileSync(previousProjector, 'previous projector')
    const old = {
      ...installed(name, 14),
      filepath: previous,
      ...(sameName && {
        sourceRepo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
        sourceFilename: 'gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf'
      })
    }
    let manifest = [old]
    const sequence = []
    const upgrade = loadFunction('utils/huggingface.ts', 'upgradeLocalModel', {
      ...upgradeFiles,
      // Production size checks use the real catalogue. The test assets are tiny GGUF stand-ins.
      verifyStagedGguf: (file) => upgradeFiles.verifyStagedGguf(file, 40),
      fs,
      path,
      createHash,
      localModelUpgradeNotice,
      listModels: () => manifest,
      readManifest: () => manifest,
      writeManifest: (next) => {
        manifest = next
      },
      normalizeModelPath: (entry) => path.resolve(root, entry.filepath),
      getHfCacheDir: () => root,
      getInstallDir: () => root,
      activeDownloads: new Map(),
      modelUpgradeDirs: new Set(),
      activeDownloadKey: (...parts) => parts.join(':'),
      resumeDownload: () => {},
      isVisionProjector: (file) => file.includes('mmproj'),
      isMtpDraftModel: (file) => file.startsWith('mtp-'),
      log: { warn: (error) => assert.fail(error) },
      downloadModelInner: async (_repo, filename, pending) => {
        sequence.push('download')
        assert.equal(fs.readFileSync(previous, 'utf8'), 'previous model')
        assert.equal(fs.readFileSync(previousProjector, 'utf8'), 'previous projector')
        const accessory = filename.includes('mmproj') || filename.startsWith('mtp-')
        if (outcome === 'download-fault' && !accessory) throw new Error('Connection lost')
        fs.writeFileSync(
          pending,
          Buffer.concat([
            Buffer.from(outcome === 'bad-header' && !accessory ? 'oops' : 'GGUF'),
            Buffer.alloc(36)
          ])
        )
      }
    })
    const run = upgrade(repo, name, {
      switchRuntime: (switchFiles) => switchFiles(),
      beforeSwitch: async () => {
        sequence.push('stop')
        if (outcome === 'move-fault') {
          // The last staged file cannot be promoted. Earlier moves must roll back.
          for (const file of fs.readdirSync(path.dirname(final))) {
            if (file.endsWith(`${newName}.pending`))
              fs.unlinkSync(path.join(path.dirname(final), file))
          }
        }
      },
      activate: async (installedName) => {
        sequence.push('activate')
        assert.equal(installedName, newName)
        assert.equal(fs.readFileSync(final).subarray(0, 4).toString(), 'GGUF')
        assert.ok(
          fs.readdirSync(path.dirname(previous)).some((file) => file.includes('model-backup'))
        )
        if (outcome === 'not-listed') throw new Error('New model is not listed')
      },
      beforeRollback: async () => sequence.push('stop-for-rollback')
    })
    if (outcome !== 'ok') {
      await assert.rejects(run)
      assert.equal(fs.readFileSync(previous, 'utf8'), 'previous model')
      assert.equal(fs.readFileSync(previousProjector, 'utf8'), 'previous projector')
      assert.deepEqual(manifest, [old])
      assert.equal(sequence.includes('stop'), ['move-fault', 'not-listed'].includes(outcome))
      assert.equal(sequence.includes('stop-for-rollback'), outcome === 'not-listed')
      return
    }
    assert.equal(await run, final)
    assert.deepEqual(sequence.slice(-2), ['stop', 'activate'])
    if (!sameName) {
      assert.equal(fs.existsSync(previous), false)
      assert.equal(fs.existsSync(previousProjector), false)
    }
    assert.equal(manifest.find((file) => file.category === 'llm').filename, newName)
    assert.ok(!fs.readdirSync(path.dirname(previous)).some((file) => file.includes('model-backup')))
  })
}

test('runtime reload checks the model list before announcing success to WebUI', async () => {
  const events = []
  let ids = ['old-model']
  const reload = loadFunction('index.ts', 'reloadLlamaCppModelsAfterDownload', {
    path,
    URL,
    AbortSignal,
    setTimeout: (callback) => callback(),
    CONFIG: {},
    inferenceCoordinator: { current: null },
    getLlamaCppInfo: () => ({ status: null }),
    getConfig: async () => ({ llamaCpp: { enabled: true } }),
    setConfig: async () => {},
    stopLlamaCpp: async () => events.push('stop'),
    startLlamaCppWithFallback: async () => ({ url: 'http://127.0.0.1:1234' }),
    fetch: async (url) => {
      assert.equal(url.pathname, '/v1/models')
      return { ok: true, json: async () => ({ data: ids.map((id) => ({ id })) }) }
    },
    sendToRenderer: (event) => events.push(event),
    log: { info: () => {}, error: () => {} }
  })
  await assert.rejects(
    reload('new-model.gguf', { modelId: 'new-model', strict: true }),
    /did not list/
  )
  assert.ok(!events.includes('models:refresh'))
  ids = ['new-model']
  await reload('new-model.gguf', { modelId: 'new-model', strict: true })
  assert.ok(events.includes('models:refresh'))
})

test('the staging downloader never publishes a truncated asset, and resumes it on retry', async (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'aurapro-model-stage-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const pending = path.join(dir, '.model.pending')
  const payload = Buffer.concat([Buffer.from('GGUF'), Buffer.alloc(60)])
  const activeDownloads = new Map()
  let prefixOnly = true
  const globals = {
    fs,
    path,
    AbortController,
    activeDownloads,
    writeDownloadBody,
    verifyStagedGguf: upgradeFiles.verifyStagedGguf,
    log: { warn: () => {}, info: () => {}, error: () => {} },
    getIndexTranslateUpgrade: () => undefined,
    fetchRemoteFileSize: async () => payload.length,
    readManifest: () => assert.fail('staged files must not reach the manifest'),
    fetch: async (_url, { headers }) => {
      assert.equal(headers.Range, prefixOnly ? undefined : 'bytes=16-')
      return {
        ok: true,
        status: prefixOnly ? 200 : 206,
        headers: new Headers(prefixOnly ? {} : { 'content-range': 'bytes 16-63/64' }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(prefixOnly ? payload.subarray(0, 16) : payload.subarray(16))
            controller.close()
          }
        })
      }
    }
  }
  for (const fn of ['parseContentRangeTotal', 'parseContentLength']) {
    globals[fn] = loadFunction('utils/huggingface.ts', fn, globals)
  }
  const download = loadFunction('utils/huggingface.ts', 'downloadModelInner', globals)
  const run = () =>
    download(
      'owner/repo',
      'model.gguf',
      pending,
      'model',
      'model',
      'id',
      undefined,
      undefined,
      64,
      undefined,
      undefined,
      true
    )
  await assert.rejects(run(), /incomplete/)
  assert.equal(fs.existsSync(pending), false)
  assert.equal(fs.statSync(`${pending}.tmp`).size, 16)
  prefixOnly = false
  assert.equal(await run(), pending)
  assert.deepEqual(fs.readFileSync(pending), payload)
  assert.equal(activeDownloads.size, 0)
})

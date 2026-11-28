import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import {
  downloadIndicMirrorFile,
  fetchIndicMirrorManifest,
  parseIndicMirrorManifest
} from '../src/main/utils/indicconformer-mirror.ts'
import {
  selectedSpeechLanguages,
  speechAsrGroup
} from '../src/main/utils/speech-language-presets.ts'

const revision = 'b'.repeat(40)
const required = ['encoder.onnx', 'ctc_decoder.onnx', 'vocab.json', 'language_masks.json'].map(
  (name) => `assets/${name}`
)
const entry = (name, content = 'model') => ({
  path: name,
  size: Buffer.byteLength(content),
  sha256: createHash('sha256').update(content).digest('hex')
})
const external = entry('assets/layers.0.weight')
const manifest = {
  schemaVersion: 1,
  revision,
  files: [...required.map((name) => entry(name)), external]
}

test('validates a complete ASCII, case-insensitively unique model manifest', () => {
  assert.deepEqual(parseIndicMirrorManifest(manifest, required), {
    revision,
    files: manifest.files
  })
  for (const filename of [
    '../model',
    'assets/../model',
    'assets/CON.txt',
    'assets/folder\\model',
    'assets/encoder.onnx.',
    'assets/ENCODER.ONNX',
    'assets/extra.onnx',
    'assets/%2e%2e',
    'assets/model.tmp',
    'assets/layers.0.WEIGHT'
  ]) {
    assert.throws(
      () =>
        parseIndicMirrorManifest(
          { ...manifest, files: [...manifest.files, entry(filename)] },
          required
        ),
      /Invalid IndicConformer/
    )
  }
  for (const invalid of [
    { ...manifest, revision: 'main' },
    { ...manifest, files: manifest.files.slice(1) },
    { ...manifest, files: manifest.files.slice(0, -1) },
    { ...manifest, files: [...manifest.files, { ...entry('assets/huge'), size: 9 * 1024 ** 3 }] },
    { ...manifest, files: [...manifest.files, { ...entry('assets/invalid'), sha256: 'missing' }] }
  ]) {
    assert.throws(() => parseIndicMirrorManifest(invalid, required), /Invalid IndicConformer/)
  }
})

test('fetches only the official public manifest, aborts redirects, and bounds the response size', async () => {
  const result = await fetchIndicMirrorManifest(required, async (url, options) => {
    assert.equal(url.href, 'https://aurapro.xmray.de/speech-models/indicconformer/manifest.json')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    assert.equal(options.headers, undefined)
    return Response.json(manifest)
  })
  assert.deepEqual(result.files, manifest.files)
  await assert.rejects(
    fetchIndicMirrorManifest(required, async () => new Response(null, { status: 404 })),
    /404/
  )
  await assert.rejects(
    fetchIndicMirrorManifest(required, async () => new Response('x'.repeat(300000))),
    /too large/
  )
})

test('rejects a same-size corrupt download, then installs verified bytes and reuses them', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aurapro-indic-test-'))
  try {
    const url = `https://aurapro.xmray.de/speech-models/indicconformer/versions/${revision}/${external.path}`
    const load = (body) =>
      downloadIndicMirrorFile(directory, revision, external, async (source, target) => {
        assert.equal(source, url)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, body)
      })
    await assert.rejects(load('other'), /integrity check failed/)
    const final = path.join(directory, revision, external.path)
    await assert.rejects(readFile(final), { code: 'ENOENT' })
    assert.equal(await load('model'), final)
    assert.equal(await readFile(final, 'utf8'), 'model')
    assert.equal(
      await downloadIndicMirrorFile(directory, revision, external, () =>
        assert.fail('redownloaded')
      ),
      final
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const sherpaSource = readFileSync(new URL('../src/main/utils/sherpa.ts', import.meta.url), 'utf8')
const plannerSource = sherpaSource.slice(
  sherpaSource.indexOf('const ensureAsrModels ='),
  sherpaSource.indexOf('const buildTtsProfiles =')
)

test('Chinese-only startup skips the mirror; migration uses one shared Indic profile and never downloads a fallback', async () => {
  const calls = []
  const repo = 'csukuangfj/sherpa-onnx-sense-voice-funasr-nano-int8-2025-12-17'
  const chinese = { SHERPA_ASR_MODEL: 'chinese.onnx' }
  const managedFallback = {
    SHERPA_ASR_NAME: repo,
    SHERPA_ASR_MANAGED: 'true',
    SHERPA_ASR_INDIC_FALLBACK: 'true'
  }
  let available = false
  const box = {
    Error,
    path,
    AbortSignal,
    log: { warn: () => {} },
    buildAsrProfiles: ({ asrProfiles }) =>
      Object.fromEntries(
        Object.entries(asrProfiles).filter(([, profile]) => profile.SHERPA_ASR_NAME !== repo)
      ),
    requestedSpeechLanguages: selectedSpeechLanguages,
    speechAsrGroup,
    speechProfileReady: (profile) => Boolean(profile),
    SPEECH_ASR_LANGUAGES: ['hi', 'bn', 'ne', 'zh'],
    DEFAULT_ASR_PRESETS: [
      {
        id: 'indic',
        repo: 'indic',
        asrType: 'indic_ctc',
        profileKeys: ['hindi'],
        files: required.map((filename, index) => ({
          filename,
          field: ['asrModel', 'asrDecoder', 'asrTokens', 'asrLanguageMasks'][index]
        }))
      }
    ],
    downloadModel: async () => {
      calls.push('fallback')
      return 'old.onnx'
    },
    fetchIndicMirrorManifest: async (paths) => {
      calls.push('mirror')
      if (!available) throw new Error('offline')
      return parseIndicMirrorManifest(manifest, paths)
    },
    getHfCacheDir: () => 'models',
    cleanModelId: (id) => id,
    parallelLimit: async (tasks, limit) => {
      assert.equal(limit, 2)
      return Promise.all(tasks.map((task) => task()))
    },
    downloadIndicMirrorFile: async (_directory, _revision, file) => `model/${file.path}`,
    recordSherpaAsrFiles: (_repo, files) => calls.push(files.length),
    compactEnv: (object) =>
      Object.fromEntries(
        Object.entries(object)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)])
      )
  }
  const install = vm.runInNewContext(
    ts.transpileModule(`${plannerSource}\nensureAsrModels`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText,
    box
  )
  const initial = { asrProfiles: { zh: chinese } }
  assert.equal(await install(initial, undefined, false), initial)
  assert.deepEqual(calls, [])
  const withFallback = {
    enabledLanguages: ['hi', 'bn', 'ne'],
    asrProfiles: { zh: chinese, hi: managedFallback, bn: managedFallback, hindi: managedFallback }
  }
  assert.equal(await install(withFallback, undefined, false, 'without-indic'), withFallback)
  assert.deepEqual(calls, [])
  await assert.rejects(
    install(withFallback, undefined, false, 'only-indic'),
    /IndicConformer download failed: offline/
  )
  assert.deepEqual(calls, ['mirror'])
  available = true
  const custom = { SHERPA_ASR_MODEL: 'custom-hi.onnx' }
  const updated = await install(
    { ...withFallback, asrProfiles: { ...withFallback.asrProfiles, hi: custom } },
    undefined,
    false,
    'only-indic'
  )
  assert.equal(await install(updated, undefined, false, 'only-indic'), updated)
  assert.deepEqual(calls, ['mirror', 'mirror', manifest.files.length])
  assert.equal(updated.asrProfiles.hi, custom)
  assert.equal(updated.asrProfiles.bn, undefined)
  assert.equal(updated.asrProfiles.ne, undefined)
  assert.deepEqual(JSON.parse(updated.asrProfiles.hindi.SHERPA_ASR_EXTERNAL_FILES), [
    'model/assets/layers.0.weight'
  ])
  assert.equal(updated.asrProfiles.zh, chinese)
})

test('automatic migration only commits after the running Indic recognizer passes its probe', async () => {
  const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const code = main.slice(
    main.indexOf('const updateIndicSpeechInBackground ='),
    main.indexOf('const scheduleIndicSpeechModelUpdate =')
  )
  const { outputText } = ts.transpileModule(`${code}\nupdateIndicSpeechInBackground`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  })
  for (const failAt of [null, 'download', 'probe']) {
    const previous = { enabled: true, port: 39384 }
    const candidate = { ...previous, asrProfiles: { hindi: { SHERPA_ASR_TYPE: 'indic_ctc' } } }
    const events = []
    const update = vm.runInNewContext(outputText, {
      indicUpdate: null,
      isQuiting: false,
      triedIndicUpdate: false,
      speechRepairInProgress: false,
      startupRepairInProgress: false,
      glossarySpeechDownloadPending: false,
      speechOperations: 0,
      indicUpdateSwitching: false,
      indicUpdateRetries: 0,
      CONFIG: null,
      getConfig: async () => ({ sherpa: previous }),
      getSherpaInfo: async () => ({ url: 'http://127.0.0.1:39385' }),
      URL,
      Error,
      isSherpaInstalled: () => true,
      validateSherpaProcess: () => true,
      indicSpeechModelUpdateLanguages: () => ['ne'],
      prepareIndicSpeechModelUpdate: async () => {
        events.push('download')
        if (failAt === 'download') throw new Error('offline')
        return candidate
      },
      ensureSherpaStartupDependencies: async () => events.push('deps'),
      stopSherpa: async () => events.push('stop'),
      startSherpa: async (port, _status, config) => {
        assert.equal(port, 39385)
        events.push(config === candidate ? 'start-new' : 'restore')
        return { pid: 1 }
      },
      verifySherpaRecognition: async (_server, language, profile) => {
        assert.equal(language, 'ne')
        assert.equal(profile, 'hindi')
        events.push('probe')
        if (failAt === 'probe') throw new Error('could not initialize ONNX')
      },
      setConfig: async (cfg) => {
        assert.equal(cfg.sherpa.asrProfiles.hindi.SHERPA_ASR_TYPE, 'indic_ctc')
        events.push('commit')
      },
      sendToRenderer: () => {},
      toIpcSafeValue: (value) => value,
      log: { warn: () => {}, error: () => {} },
      getErrorMessage: (error) => error.message,
      setTimeout: () => ({ unref: () => undefined })
    })
    await update()
    assert.deepEqual(
      events,
      failAt === 'download'
        ? ['download']
        : failAt === 'probe'
          ? ['download', 'deps', 'stop', 'start-new', 'probe', 'stop', 'restore']
          : ['download', 'deps', 'stop', 'start-new', 'probe', 'commit']
    )
  }
})

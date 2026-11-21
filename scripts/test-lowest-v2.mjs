import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { Writable } from 'node:stream'
import ts from 'typescript'
import test from 'node:test'
import {
  INDEX_TRANSLATE_MODELS,
  indexTranslateCatalogEntry
} from '../src/shared/index-translate-models.ts'

const loadBindings = (filename, names, context) => {
  const source = ts.createSourceFile(
    filename,
    fs.readFileSync(`src/main/utils/${filename}`, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  for (const name of names) {
    const statement = source.statements.find(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((decl) => decl.name.getText(source) === name)
    )
    assert.ok(statement, name)
    vm.runInContext(
      ts.transpileModule(
        `${statement.getText(source).replace(/^export\s+/, '')}; globalThis.${name}=${name}`,
        {
          compilerOptions: { target: ts.ScriptTarget.ES2022 }
        }
      ).outputText,
      context
    )
  }
}

const modelScreens = [
  'src/renderer/src/lib/components/Setup/LocalInstall.svelte',
  'src/renderer/src/lib/components/Main/Connections/GetStartedModal.svelte',
  'src/renderer/src/lib/components/Main/Settings/Models.svelte'
]

test('all model selection screens use the shared Omni download catalog', () => {
  const expected = {
    lowest: ['2B', 'Q6_K', 1_973_568_256, 361_518_144],
    medium: ['9B', 'Q4_K_S', 5_351_629_472, 620_690_272],
    high: ['35B', 'Q4_K_M', 21_166_757_824, 610_655_072]
  }
  for (const [key, [family, quant, size, projectorSize]] of Object.entries(expected)) {
    const model = INDEX_TRANSLATE_MODELS[key]
    const entry = indexTranslateCatalogEntry(model)
    assert.equal(entry.hfRepo, `IndexTeam/Index-Translate-omni-${family}-GGUF`)
    assert.equal(entry.filename, `Index-Translate-omni-${family}.${quant}.gguf`)
    assert.equal(entry.mmprojRepo, entry.hfRepo)
    assert.equal(entry.mmprojFilename, `Index-Translate-omni-${family}.mmproj-Q8_0.gguf`)
    assert.equal(entry.sizeBytes, size)
    assert.equal(model.projector.expectedSize, projectorSize)
    assert.equal('mtpFilename' in entry, false)
  }
  const context = vm.createContext({ INDEX_TRANSLATE_MODELS, GB: 1024 ** 3 })
  loadBindings('llamacpp-diagnostics.ts', ['OFFICIAL_MODEL_SOURCES'], context)
  for (const model of Object.values(INDEX_TRANSLATE_MODELS)) {
    const repair = context.OFFICIAL_MODEL_SOURCES[model.name]
    assert.equal(repair.saveAs, model.name)
    assert.equal(repair.repo, model.current.repo)
    assert.equal(repair.filename, model.current.filename)
    assert.equal(repair.expectedSize, model.current.expectedSize)
  }
  for (const file of modelScreens) {
    const source = fs.readFileSync(file, 'utf8')
    for (const key of Object.keys(expected)) {
      assert.ok(source.includes(`indexTranslateCatalogEntry(INDEX_TRANSLATE_MODELS.${key})`), file)
    }
    assert.match(
      source,
      /name: 'high_Q4\.gguf',[\s\S]*?\},\s*indexTranslateCatalogEntry\(INDEX_TRANSLATE_MODELS\.high\)/
    )
    assert.doesNotMatch(source, /'lowest.gguf'/)
    assert.doesNotMatch(source, /modelByName\('high_Q4_2.gguf'\)/)
  }
})

test('runtime never attaches a draft to any of the Index Translate models', () => {
  const names = [
    'getMmprojPrefixForModel',
    'getMtpRepoForPrefix',
    'getMtpFilenameForPrefix',
    'findModelDraft'
  ]
  const context = vm.createContext({ path })
  loadBindings('llamacpp.ts', names, context)
  for (const model of Object.values(INDEX_TRANSLATE_MODELS)) {
    const prefix = context.getMmprojPrefixForModel(model.name)
    assert.equal(context.getMtpRepoForPrefix(prefix), null)
    assert.equal(context.getMtpFilenameForPrefix(prefix), null)
    assert.equal(context.findModelDraft(`/models/test/${model.name}`), null)
  }
})

test('medium V2 replaces automatic recommendations while keeping the old model downloadable', () => {
  for (const file of modelScreens) {
    const source = fs.readFileSync(file, 'utf8')
    assert.match(source, /name: 'medium_Q4.gguf'/)
    if (file.endsWith('/Models.svelte')) continue
    assert.doesNotMatch(source, /modelByName\('medium_Q4.gguf'\)/)
    const script = source.split('<script lang="ts">')[1].split('</script>')[0]
    const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true)
    const context = vm.createContext({
      platform: 'win32',
      systemMemGB: 16,
      dedicatedVramGB: 8,
      modelPreference: 'speed',
      modelByName: (name) => name
    })
    for (const name of ['isAppleSiliconMac', 'qualityRecommendation', 'recommendedModel']) {
      const statement = ast.statements.find(
        (node) =>
          ts.isVariableStatement(node) &&
          node.declarationList.declarations.some((decl) => decl.name.getText(ast) === name)
      )
      assert.ok(statement, name)
      vm.runInContext(
        ts.transpileModule(`${statement.getText(ast)}; globalThis.${name}=${name}`, {
          compilerOptions: { target: ts.ScriptTarget.ES2022 }
        }).outputText,
        context
      )
    }
    assert.equal(context.recommendedModel(), 'medium_Q4_V2.gguf')
    context.systemMemGB = 32
    assert.equal(context.recommendedModel(), 'high_Q4.gguf')
    Object.assign(context, {
      platform: 'darwin',
      systemArchitecture: 'arm64',
      systemMemGB: 16,
      modelPreference: 'quality'
    })
    assert.equal(context.recommendedModel(), 'medium_Q4_V2.gguf')
  }
})

test('all migrated models pair with only the correctly sized projectors for their revisions', () => {
  const files = new Map()
  const context = vm.createContext({
    path,
    INDEX_TRANSLATE_MODELS,
    hasLegacyInternalMtp: () => false,
    fs: {
      statSync: (name) => {
        if (!files.has(name)) throw new Error('Missing file')
        return { size: files.get(name), isFile: () => true }
      }
    }
  })
  loadBindings(
    'index-translate.ts',
    ['getIndexTranslateModel', 'getIndexTranslateProjector'],
    context
  )
  loadBindings('llamacpp.ts', ['findModelMmproj'], context)
  loadBindings('llamacpp-diagnostics.ts', ['getMmprojSource'], context)

  for (const model of Object.values(INDEX_TRANSLATE_MODELS)) {
    files.clear()
    const filepath = path.join('models', model.name)
    const previousPath = path.join(path.dirname(filepath), model.previous.projector.filename)
    const omniPath = path.join(path.dirname(filepath), model.projector.filename)
    files.set(previousPath, model.previous.projector.expectedSize)
    files.set(filepath, model.current.expectedSize)
    assert.equal(context.getMmprojSource(model.name, filepath), model.projector)
    assert.equal(context.findModelMmproj(filepath), null)
    files.set(omniPath, 9)
    assert.equal(context.findModelMmproj(filepath), null)
    files.set(omniPath, model.projector.expectedSize)
    assert.equal(context.findModelMmproj(filepath), omniPath)
    files.set(filepath, model.previous.expectedSize)
    assert.equal(context.getMmprojSource(model.name, filepath), model.previous.projector)
    assert.equal(context.findModelMmproj(filepath), previousPath)
    files.delete(previousPath)
    assert.equal(context.findModelMmproj(filepath), null)
    files.set(filepath, 10)
    assert.equal(context.findModelMmproj(filepath), null)
  }
})

for (const [key, model] of Object.entries(INDEX_TRANSLATE_MODELS)) {
  test(`${model.name} uses its own Omni resume file and preserves the previous model on failure`, async () => {
    const modelKey = path.basename(model.name, '.gguf')
    const filepath = path.join('models', modelKey, model.name)
    const previousPartial = `${filepath}.tmp`
    const omniPartial = `${filepath}${model.partialSuffix}`
    const files = new Map([
      [filepath, 12],
      [previousPartial, 4]
    ])
    let manifest = []
    let isFirstAttempt = true
    const context = vm.createContext({
      path,
      INDEX_TRANSLATE_MODELS: {
        ...INDEX_TRANSLATE_MODELS,
        [key]: { ...model, current: { ...model.current, expectedSize: 8 } }
      },
      AbortController,
      Buffer,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      activeDownloads: new Map(),
      getInstallDir: () => '.',
      fetchRemoteFileSize: async () => 8,
      readManifest: () => manifest,
      writeManifest: (entries) => (manifest = entries),
      isVisionProjector: () => false,
      isMtpDraftModel: () => false,
      fetch: async (_url, { headers }) => {
        assert.equal(headers.Range, isFirstAttempt ? undefined : 'bytes=3-')
        const value = Buffer.alloc(isFirstAttempt ? 3 : 5)
        let done = false
        return {
          ok: true,
          status: isFirstAttempt ? 200 : 206,
          headers: new Headers(),
          body: {
            getReader: () => ({
              read: async () => {
                if (done) return { done: true }
                done = true
                return { value, done: false }
              }
            })
          }
        }
      },
      fs: {
        existsSync: (name) => files.has(name),
        statSync: (name) => ({ size: files.get(name) }),
        unlinkSync: (name) => files.delete(name),
        renameSync: (src, dest) => {
          files.set(dest, files.get(src))
          files.delete(src)
        },
        createWriteStream: (name, { flags }) => {
          if (flags === 'w') files.set(name, 0)
          return new Writable({
            write(chunk, _encoding, callback) {
              files.set(name, files.get(name) + chunk.length)
              callback()
            }
          })
        }
      }
    })
    loadBindings(
      'index-translate.ts',
      [
        'getIndexTranslateModel',
        'getIndexTranslateUpgrade',
        'indexTranslatePartialPath',
        'indexTranslatePartialDestination'
      ],
      context
    )
    assert.equal(context.indexTranslatePartialDestination(omniPartial), filepath)
    assert.equal(context.indexTranslatePartialDestination(previousPartial), undefined)
    assert.equal(context.indexTranslatePartialDestination(`${filepath}.omni-123b.tmp`), undefined)
    loadBindings(
      'huggingface.ts',
      ['parseContentLength', 'parseContentRangeTotal', 'downloadModelInner'],
      context
    )

    const download = () =>
      context.downloadModelInner(
        model.current.repo,
        model.current.filename,
        filepath,
        modelKey,
        modelKey,
        'download',
        undefined,
        undefined,
        8,
        model.name
      )
    await assert.rejects(download(), /expected 8 bytes, got 3 bytes/)
    assert.equal(files.get(filepath), 12)
    assert.equal(files.get(previousPartial), 4)
    assert.equal(files.get(omniPartial), 3)
    assert.equal(manifest.length, 0)
    isFirstAttempt = false
    assert.equal(await download(), filepath)
    assert.equal(files.get(filepath), 8)
    assert.equal(files.has(omniPartial), false)
    assert.equal(manifest[0].sourceFilename, model.current.filename)
  })
}

test('no official model enables the DRY sampler (it corrupts copied IDs and numbers)', () => {
  // DRY penalises repeating any long token run already in context, including the source
  // text. Measured on lowest_V2: allowed length 6 changed 20/35 copied IDs (order and ID-card
  // numbers, commands); even 24 still broke a 40-digit serial. Runaways are bounded by the
  // backend translation token cap instead.
  const source = ts.createSourceFile(
    'llamacpp.ts',
    fs.readFileSync('src/main/utils/llamacpp.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const context = vm.createContext({ path, os: { totalmem: () => 32 * 1024 ** 3 }, process })
  for (const name of ['getMmprojPrefixForModel', 'getPresetModelOverrides']) {
    const statement = source.statements.find(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((decl) => decl.name.getText(source) === name)
    )
    assert.ok(statement, name)
    vm.runInContext(
      ts.transpileModule(`${statement.getText(source)}; globalThis.${name}=${name}`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
      }).outputText,
      context
    )
  }
  for (const model of [
    'lowest_V2.gguf',
    'medium_Q4_V2.gguf',
    'high_Q4_2.gguf',
    'medium_Q4.gguf',
    'high_Q4.gguf',
    'low_E4.gguf'
  ]) {
    const overrides = context.getPresetModelOverrides(`/models/x/${model}`)
    assert.ok(!Object.keys(overrides).some((key) => key.startsWith('dry-')), model)
  }
  assert.doesNotMatch(fs.readFileSync('src/main/utils/llamacpp.ts', 'utf8'), /'dry-multiplier = /)
})

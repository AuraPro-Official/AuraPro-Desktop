import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { Writable } from 'node:stream'
import { writeDownloadBody } from '../src/main/utils/download-stream.ts'
import ts from 'typescript'
import test from 'node:test'
import {
  INDEX_TRANSLATE_MODELS,
  indexTranslateCatalogEntry
} from '../src/shared/index-translate-models.ts'
import {
  recommendInstallModel,
  recommendWizardModel
} from '../src/renderer/src/lib/utils/install-model-recommendation.ts'
import {
  PRO_MODEL_GUIDE,
  proHardwareLabel,
  proRequirementLabel,
  recommendProInstallModel,
  STANDARD_MODEL_GUIDE,
  standardRequirementLabel
} from '../src/shared/model-hardware.ts'
import * as desktopGuide from '../src/renderer/src/lib/pro-model-tutorial.ts'

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
    mediumQ3: ['9B', 'Q3_K_M', 4_623_524_512, 620_690_272],
    medium: ['9B', 'Q4_K_S', 5_351_629_472, 620_690_272],
    mediumQ6: ['9B', 'Q6_K', 7_359_259_296, 620_690_272],
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
  loadBindings('llamacpp.ts', ['AURA_MODEL_FILENAMES'], context)
  for (const model of Object.values(INDEX_TRANSLATE_MODELS)) {
    assert.ok(context.AURA_MODEL_FILENAMES.includes(model.name))
  }
  for (const file of modelScreens) {
    const source = fs.readFileSync(file, 'utf8')
    for (const key of Object.keys(expected)) {
      assert.ok(source.includes(`indexTranslateCatalogEntry(INDEX_TRANSLATE_MODELS.${key})`), file)
    }
    assert.match(
      source,
      /(?:name: 'high_Q4\.gguf',[\s\S]*?\}|HIGH_Q4_DOWNLOAD),\s*indexTranslateCatalogEntry\(INDEX_TRANSLATE_MODELS\.high\)/
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

test('medium Q4 is retired and both wizards use the shared recommendation', () => {
  for (const file of modelScreens) {
    const source = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /'medium_Q4\.gguf'/, file)
    assert.ok(source.includes('indexTranslateCatalogEntry(INDEX_TRANSLATE_MODELS.medium)'), file)
    if (file.endsWith('/Models.svelte')) continue
    assert.match(source, /recommendWizardModel\(/)
  }
})

test('medium Q6 is a manual option independent of the medium Q4 recommendation', () => {
  const q4 = indexTranslateCatalogEntry(INDEX_TRANSLATE_MODELS.medium)
  const q6 = indexTranslateCatalogEntry(INDEX_TRANSLATE_MODELS.mediumQ6)
  assert.equal(q6.name, 'medium_Q6_V2.gguf')
  assert.equal(q6.sizeStr, '~8G')
  assert.equal(standardRequirementLabel(q6.name), standardRequirementLabel(q4.name))
  assert.equal(q6.mmprojRepo, q4.mmprojRepo)
  assert.equal(q6.mmprojFilename, q4.mmprojFilename)
  assert.equal(
    desktopGuide.standardModelTutorial.table.rows.some((row) => row[0]['en-US'] === 'medium_Q6_V2'),
    false
  )

  for (const platform of ['win32', 'linux', 'darwin']) {
    for (const preference of ['quality', 'balanced']) {
      const hardware = {
        platform,
        architecture: platform === 'darwin' ? 'arm64' : 'x64',
        memoryGiB: 16,
        vramGiB: platform === 'darwin' ? 0 : 8,
        preference
      }
      assert.equal(recommendWizardModel(hardware, [q6, q4], [], false), q4)
      assert.equal(recommendWizardModel(hardware, [q6], [], false), null)
    }
  }
})

test('Windows and Linux match GPU tiers before falling back on low system RAM', () => {
  const cases = [
    [8, 0, 'lowest_V2', 'lowest_V2'],
    [12, 4, 'lowest_V2', 'lowest_V2'],
    [12, 6, 'medium_Q3_V2', 'low_E4'],
    [12, 8, 'medium_Q4_V2', 'medium_Q4_V2'],
    [12, 12, 'medium_Q4_V2', 'high_Q4'],
    [16, 0, 'low_E4', 'low_E4'],
    [16, 4, 'low_E4', 'low_E4'],
    [16, 7, 'medium_Q3_V2', 'low_E4'],
    [24, 4, 'medium_IQ2', 'medium_IQ2'],
    [24, 6, 'medium_Q3_V2', 'medium_IQ2'],
    [32, 4, 'high_Q4', 'high_Q4'],
    [32, 8, 'medium_Q4_V2', 'medium_Q4_V2'],
    [32, 12, 'medium_Q4_V2', 'high_Q4'],
    [48, 0, 'high_Q4', 'low_E4'],
    [48, 4, 'high_Q4_2', 'high_Q4_2'],
    [64, 0, 'high_Q4_2', 'high_Q4_2']
  ]
  for (const platform of ['win32', 'linux']) {
    for (const [memoryGiB, vramGiB, quality, balanced] of cases) {
      for (const [preference, expected] of Object.entries({ quality, balanced })) {
        assert.equal(
          recommendInstallModel({ platform, architecture: 'x64', memoryGiB, vramGiB, preference }),
          `${expected}.gguf`,
          `${platform} ${memoryGiB} GiB RAM + ${vramGiB} GiB VRAM (${preference})`
        )
      }
    }
  }
})

test('Mac recommendations use distinct Intel and Apple Silicon tiers', () => {
  const cases = [
    ['x64', 12, 'lowest_V2', 'lowest_V2'],
    ['x64', 16, 'medium_Q3_V2', 'low_E4'],
    ['x64', 32, 'medium_Q3_V2', 'low_E4'],
    ['arm64', 7, 'lowest_V2', 'lowest_V2'],
    ['arm64', 8, 'medium_Q3_V2', 'low_E4'],
    ['arm64', 12, 'medium_Q3_V2', 'low_E4'],
    ['arm64', 16, 'medium_Q4_V2', 'medium_Q4_V2'],
    ['arm64', 18, 'medium_Q4_V2', 'medium_Q4_V2'],
    ['arm64', 20, 'medium_Q4_V2', 'medium_Q4_V2'],
    ['arm64', 24, 'high_Q4', 'high_Q4'],
    ['arm64', 28, 'high_Q4', 'high_Q4'],
    ['arm64', 32, 'high_Q4_2', 'high_Q4_2']
  ]
  for (const [architecture, memoryGiB, quality, balanced] of cases) {
    for (const [preference, expected] of Object.entries({ quality, balanced })) {
      assert.equal(
        recommendInstallModel({
          platform: 'darwin',
          architecture,
          memoryGiB,
          vramGiB: 0,
          preference
        }),
        `${expected}.gguf`
      )
    }
  }
})

test('Pro quality and balanced use the matching platform column only', () => {
  const all = Object.keys(PRO_MODEL_GUIDE)
  const pick = (platform, architecture, memoryGiB, vramGiB, preference) =>
    recommendProInstallModel({ platform, architecture, memoryGiB, vramGiB, preference }, all)

  for (const platform of ['win32', 'linux']) {
    for (const [ram, vram, quality, balanced] of [
      [12, 8, null, null],
      [47, 12, null, null],
      [48, 11, null, null],
      [48, 12, 'Q2_0', 'Q2_0'],
      [63, 8, null, null],
      [64, 8, 'IQ2_XS', 'Q2_0'],
      [64, 12, 'Q2_K_XL', 'IQ2_XS'],
      [64, 16, 'IQ3_XXS', 'Q2_K_XL'],
      [96, 12, 'Q3_K_XL', 'Q2_K_XL'],
      [96, 16, 'IQ4_XS', 'IQ3_XXS'],
      [192, 24, 'IQ4_XS', 'IQ3_XXS']
    ]) {
      assert.equal(pick(platform, 'x64', ram, vram, 'quality'), quality)
      assert.equal(pick(platform, 'x64', ram, vram, 'balanced'), balanced)
    }
    assert.equal(pick(platform, 'arm64', 192, 24, 'quality'), null)
  }
  for (const [ram, quality, balanced] of [
    [95, null, null],
    [96, 'IQ4_XS', 'Q3_K_XL'],
    [127, 'IQ4_XS', 'Q3_K_XL'],
    [128, 'Q4_K_XL', 'IQ4_XS']
  ]) {
    assert.equal(pick('darwin', 'arm64', ram, 0, 'quality'), quality)
    assert.equal(pick('darwin', 'arm64', ram, 0, 'balanced'), balanced)
  }
  assert.equal(pick('darwin', 'x64', 128, 24, 'quality'), null)
  const hardware = {
    platform: 'darwin',
    architecture: 'arm64',
    memoryGiB: 128,
    vramGiB: 0,
    preference: 'quality'
  }
  assert.equal(recommendProInstallModel(hardware, []), null)
  assert.equal(recommendProInstallModel(hardware, ['IQ4_XS']), 'IQ4_XS')
  assert.equal(recommendProInstallModel({ ...hardware, memoryGiB: 80 }, ['Q2_0']), null)
  assert.equal(
    recommendProInstallModel({ ...hardware, platform: 'win32', architecture: 'x64', vramGiB: 16 }, [
      'Q4_K_XL'
    ]),
    null
  )
})

test('Help tables use the same model sizes and Pro thresholds', async () => {
  const webuiGuide = new URL('../../AuraPro-UI/src/lib/pro-model-tutorial.ts', import.meta.url)
  if (fs.existsSync(webuiGuide))
    assert.deepEqual({ ...desktopGuide }, { ...(await import(webuiGuide.href)) })
  for (const row of desktopGuide.standardModelTutorial.table.rows) {
    const name = row[0]['en-US']
    assert.equal(row[1]['en-US'], `~${STANDARD_MODEL_GUIDE[name].sizeGiB}G`)
  }
  for (const row of desktopGuide.proModelTutorial.table.rows) {
    const name = row[0]['en-US']
    const guide = PRO_MODEL_GUIDE[name]
    assert.equal(row[1]['en-US'], `~${guide.sizeGiB}G`)
    for (const [index, preference] of ['quality', 'balanced'].entries()) {
      assert.equal(
        row[2 + index]['en-US'],
        proHardwareLabel(name, 'darwin', preference).replace('UMA ', 'M-series ')
      )
      assert.equal(
        row[4 + index]['en-US'],
        guide.pc[preference]?.map(([ram, vram]) => `≥${ram}G RAM + ≥${vram}G VRAM`).join(' or ') ??
          '—'
      )
    }
  }
  const rows = desktopGuide.modelHardwareTutorial.table.rows.map((row) =>
    row.map((cell) => cell['en-US'])
  )
  assert.deepEqual(
    rows.map(([name]) => name).sort(),
    [...Object.keys(STANDARD_MODEL_GUIDE), ...Object.keys(PRO_MODEL_GUIDE)].sort()
  )
  for (const [name, size, pc, mac] of rows) {
    const pro = PRO_MODEL_GUIDE[name]
    assert.equal(size, `~${(pro ?? STANDARD_MODEL_GUIDE[name]).sizeGiB}G`)
    assert.doesNotMatch(`${pc} ${mac}`, /Intel|GiB|GB|≥/)
    assert.equal(
      `${pc} / ${mac}`,
      pro ? proRequirementLabel(name) : standardRequirementLabel(`${name}.gguf`)
    )
  }
})

test('Linux uses the largest reported GPU VRAM without adding cards', async () => {
  const context = vm.createContext({
    path: path.posix,
    execFile: (_exe, _args, _options, callback) => callback(null, '8192\n4096\n'),
    fs: {
      promises: {
        readdir: async () => ['card0', 'card1', 'card2', 'card1-DP-1'],
        readFile: async (file) => {
          if (file.includes('/card0/')) return String(12 * 1024 ** 3)
          if (file.includes('/card1/')) return String(8 * 1024 ** 3)
          throw new Error('No driver VRAM metric')
        }
      }
    }
  })
  loadBindings('index.ts', ['getLinuxDedicatedVramGB'], context)
  assert.equal(await context.getLinuxDedicatedVramGB(), 12)
})

test('an installed medium Q4 still has its original runtime and repair sources', () => {
  const context = vm.createContext({ path, INDEX_TRANSLATE_MODELS, GB: 1024 ** 3 })
  loadBindings(
    'llamacpp.ts',
    [
      'AURA_MODEL_FILENAMES',
      'getMmprojPrefixForModel',
      'getMmprojRepoForPrefix',
      'getMtpFilenameForPrefix'
    ],
    context
  )
  loadBindings('llamacpp-diagnostics.ts', ['OFFICIAL_MODEL_SOURCES'], context)
  const filename = 'medium_Q4.gguf'
  assert.ok(context.AURA_MODEL_FILENAMES.includes(filename))
  const prefix = context.getMmprojPrefixForModel(filename)
  assert.equal(context.getMmprojRepoForPrefix(prefix), 'unsloth/gemma-4-12B-it-qat-GGUF')
  assert.equal(context.getMtpFilenameForPrefix(prefix), 'mtp-gemma-4-12B-it.gguf')
  assert.equal(context.OFFICIAL_MODEL_SOURCES[filename].saveAs, filename)
})

test('Omni models pair with only the correct projectors for their revisions', () => {
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
    const omniPath = path.join(path.dirname(filepath), model.projector.filename)
    const previousPath =
      model.previous && path.join(path.dirname(filepath), model.previous.projector.filename)
    if (previousPath) files.set(previousPath, model.previous.projector.expectedSize)
    files.set(filepath, model.current.expectedSize)
    assert.equal(context.getMmprojSource(model.name, filepath), model.projector)
    assert.equal(context.findModelMmproj(filepath), null)
    files.set(omniPath, 9)
    assert.equal(context.findModelMmproj(filepath), null)
    files.set(omniPath, model.projector.expectedSize)
    assert.equal(context.findModelMmproj(filepath), omniPath)
    if (previousPath) {
      files.set(filepath, model.previous.expectedSize)
      assert.equal(context.getMmprojSource(model.name, filepath), model.previous.projector)
      assert.equal(context.findModelMmproj(filepath), previousPath)
      files.delete(previousPath)
      assert.equal(context.findModelMmproj(filepath), null)
    } else {
      files.set(filepath, INDEX_TRANSLATE_MODELS.medium.current.expectedSize)
      assert.equal(context.getMmprojSource(model.name, filepath), undefined)
      assert.equal(context.findModelMmproj(filepath), null)
    }
    files.set(filepath, 10)
    assert.equal(context.findModelMmproj(filepath), null)
  }
})

for (const [key, model] of Object.entries(INDEX_TRANSLATE_MODELS)) {
  test(`${model.name} uses its own Omni resume file and preserves an existing file on failure`, async () => {
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
    let fileLocked = true
    let releases = 0
    const context = vm.createContext({
      path,
      INDEX_TRANSLATE_MODELS: {
        ...INDEX_TRANSLATE_MODELS,
        [key]: { ...model, current: { ...model.current, expectedSize: 8 } }
      },
      AbortController,
      Buffer,
      writeDownloadBody,
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
        return {
          ok: true,
          status: isFirstAttempt ? 200 : 206,
          headers: new Headers(),
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(value)
              controller.close()
            }
          })
        }
      },
      fs: {
        existsSync: (name) => files.has(name),
        statSync: (name) => ({ size: files.get(name) }),
        unlinkSync: (name) => files.delete(name),
        renameSync: (src, dest) => {
          if (fileLocked && dest === filepath) {
            throw Object.assign(new Error('File is in use'), { code: 'EPERM' })
          }
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
    if (key === 'mediumQ3' || key === 'mediumQ6')
      assert.equal(
        context.indexTranslatePartialDestination(
          `${filepath}${INDEX_TRANSLATE_MODELS.medium.partialSuffix}`
        ),
        undefined
      )
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
        model.name,
        async () => {
          releases++
          fileLocked = false
          return true
        }
      )
    await assert.rejects(download(), /expected 8 bytes, got 3 bytes/)
    assert.equal(files.get(filepath), 12)
    assert.equal(files.get(previousPartial), 4)
    assert.equal(files.get(omniPartial), 3)
    assert.equal(manifest.length, 0)
    assert.equal(releases, 0)
    isFirstAttempt = false
    assert.equal(await download(), filepath)
    assert.equal(files.get(filepath), 8)
    assert.equal(files.has(omniPartial), false)
    assert.equal(releases, 1)
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
    'medium_Q3_V2.gguf',
    'medium_Q4_V2.gguf',
    'medium_Q6_V2.gguf',
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

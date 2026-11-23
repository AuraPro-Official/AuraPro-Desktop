import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import {
  ALL_STRATA_MODELS,
  DEFAULT_STRATA_SETTINGS,
  LEGACY_STRATA_MODELS,
  STRATA_MODELS,
  STRATA_MODEL_ID,
  STRATA_PORT,
  STRATA_RELEASE,
  STRATA_SOURCE,
  getStrataModel,
  strataConfigName,
  strataHardwareRecommendation,
  useProDiagnostics,
  strataSetupArgs,
  nativeProFiles,
  nativeProArgs,
  validateStrataSettings
} from '../src/main/utils/strata-models.ts'

const unslothQuants = [
  'UD-IQ1_M',
  'UD-Q2_0',
  'UD-IQ2_XS',
  'UD-Q2_K_XL',
  'UD-IQ3_XXS',
  'UD-Q3_K_XL',
  'UD-IQ4_XS-v31'
]
const qwen36Quants = ['UD-Q4_K_XL', 'UD-Q6_K_XL', 'Q8_0']
const legacyIds = [
  'qwen-q2_0',
  'qwen-iq2_xs',
  'qwen-iq3_xxs',
  'qwen-iq3_s',
  'swift-iq2_xs',
  'swift-iq3_xxs',
  'coder-iq1_m',
  'unsloth-ud-q4_k_xl',
  'qwen36-q8_0'
]
const option = (args, flag) => {
  assert.ok(args.includes(flag), `Missing ${flag}`)
  return args[args.indexOf(flag) + 1]
}

test('release and service exports are stable', () => {
  assert.equal(STRATA_RELEASE, 'v0.2.15')
  assert.equal(STRATA_SOURCE, 'c77572806996349b49995e4f98d41b5294d36a21')
  assert.equal(STRATA_PORT, 18882)
  assert.equal(STRATA_MODEL_ID, 'aurapro-pro')
})

test('seven Flash-Next presets and only the Q4/Q6 35B presets are selectable', () => {
  assert.deepEqual(
    STRATA_MODELS.map(({ id, family, quant }) => [id, family, quant]),
    [
      ...unslothQuants.map((q) => [`unsloth-${q.toLowerCase()}`, 'unsloth', q]),
      ['qwen36-ud-q4_k_xl', 'qwen36', 'UD-Q4_K_XL'],
      ['qwen36-ud-q6_k_xl', 'qwen36', 'UD-Q6_K_XL']
    ]
  )
  assert.equal(new Set(STRATA_MODELS.map(({ name }) => name)).size, 9)
  assert.deepEqual(
    STRATA_MODELS.map((model) => model.name),
    ['IQ1_M', 'Q2_0', 'IQ2_XS', 'Q2_K_XL', 'IQ3_XXS', 'Q3_K_XL', 'IQ4_XS', 'lite_Q4', 'lite_Q6']
  )
})

test('retired Flash-Next variants and 35B Q8 remain compatible but not selectable', () => {
  assert.deepEqual(
    LEGACY_STRATA_MODELS.map(({ id }) => id),
    legacyIds
  )
  assert.equal(ALL_STRATA_MODELS.length, 18)
  assert.equal(new Set(ALL_STRATA_MODELS.map(({ id }) => id)).size, 18)
  assert.deepEqual(
    ALL_STRATA_MODELS.filter(({ id }) => !STRATA_MODELS.some((m) => m.id === id)).map(
      ({ id }) => id
    ),
    legacyIds
  )
  for (const model of [...STRATA_MODELS, ...LEGACY_STRATA_MODELS])
    assert.equal(getStrataModel(model.id), model)
  for (const id of ['unknown', '../../untrusted', '__proto__', 'constructor', '']) {
    assert.equal(getStrataModel(id), undefined)
    assert.throws(() => strataConfigName(id), /Unknown Pro model/)
    assert.throws(() => nativeProFiles(id), /Unknown Pro model/)
  }
})

test('fresh settings use Q2_0 without changing any saved model selection', () => {
  assert.equal(DEFAULT_STRATA_SETTINGS.model, 'unsloth-ud-q2_0')
  assert.ok(STRATA_MODELS.some((model) => model.id === DEFAULT_STRATA_SETTINGS.model))
  for (const model of ALL_STRATA_MODELS) {
    const saved = Object.freeze({
      model: model.id,
      backend: 'hip',
      context: 16384,
      kv: 'k8v4',
      vision: true
    })
    assert.deepEqual(validateStrataSettings(saved), saved)
    assert.notEqual(validateStrataSettings(saved), saved)
    assert.equal(option(strataSetupArgs(saved, '/data'), '--model'), model.quant)
  }
})

test('config lookups preserve old names and use the upstream Qwen3.6 and v3.1 names', () => {
  assert.equal(new Set(ALL_STRATA_MODELS.map(({ id }) => strataConfigName(id))).size, 18)
  assert.deepEqual(
    LEGACY_STRATA_MODELS.map(({ id }) => strataConfigName(id)),
    [
      'strata-q2_0.json',
      'strata-iq2_xs.json',
      'strata-iq3_xxs.json',
      'strata-iq3_s.json',
      'strata-swift-iq2_xs.json',
      'strata-swift-iq3_xxs.json',
      'strata-coder-iq1_m.json',
      'strata-unsloth-ud-q4_k_xl.json',
      'strata-qwen36-q8_0.json'
    ]
  )
  for (const q of qwen36Quants)
    assert.equal(
      strataConfigName(`qwen36-${q.toLowerCase()}`),
      `strata-qwen36-${q.toLowerCase()}.json`
    )
  assert.equal(strataConfigName('unsloth-ud-iq4_xs-v31'), 'strata-unsloth-ud-iq4_xs-v31.json')
})

test('setup is isolated and non-interactive, preserves settings and leaves drafting policy to Control', () => {
  for (const model of ALL_STRATA_MODELS) {
    for (const backend of ['auto', 'cuda', 'hip']) {
      for (const vision of [false, true]) {
        const args = strataSetupArgs(
          { ...DEFAULT_STRATA_SETTINGS, model: model.id, backend, vision },
          'C:/Models/Pro data'
        )
        assert.deepEqual(args.slice(0, 4), ['--setup', '--no-start', '--no-browser', '--yes'])
        for (const [flag, expected] of [
          ['--family', model.family],
          ['--model', model.quant],
          ['--context', '32768'],
          ['--vision', vision ? 'yes' : 'no'],
          ['--host', '127.0.0.1'],
          ['--port', '18882'],
          ['--data-dir', 'C:/Models/Pro data'],
          ['--models-dir', 'C:/Models/Pro data/models']
        ])
          assert.equal(option(args, flag), expected)
        if (backend === 'auto') assert.ok(!args.includes('--backend'))
        else assert.equal(option(args, '--backend'), backend)
        if (model.family === 'qwen36') assert.ok(!args.includes('--kv'))
        else assert.equal(option(args, '--kv'), 'int8')
        for (const flag of [
          '--mtp',
          '--draft',
          '--drafting',
          '--gpus',
          '--build',
          '--resident-budget-gib'
        ])
          assert.ok(!args.includes(flag))
      }
    }
  }
  for (const backend of ['metal', 'cpu'])
    assert.throws(
      () => strataSetupArgs({ ...DEFAULT_STRATA_SETTINGS, backend }, '/data'),
      /CUDA or HIP/
    )
})

test('validation rejects unsafe values, accepts boundaries and removes obsolete Unsloth HIP/vision restrictions', () => {
  for (const patch of [
    { model: '../../untrusted' },
    { model: null },
    { kv: 'f16' },
    { backend: 'invalid' },
    { vision: 'yes' },
    ...[NaN, Infinity, 0, 2047, 262145, 2048.5, '32768'].map((context) => ({ context }))
  ])
    assert.throws(() => validateStrataSettings({ ...DEFAULT_STRATA_SETTINGS, ...patch }))
  for (const input of [null, undefined, {}]) assert.throws(() => validateStrataSettings(input))
  for (const model of ALL_STRATA_MODELS) {
    for (const backend of ['auto', 'cuda', 'hip', 'metal', 'cpu']) {
      for (const context of [2048, 262144]) {
        const input = {
          ...DEFAULT_STRATA_SETTINGS,
          model: model.id,
          backend,
          context,
          vision: true
        }
        assert.deepEqual(validateStrataSettings(input), input)
      }
    }
  }
})

test('native manifests pin exact shard counts, paths, sizes and hashes for all 18 presets', () => {
  for (const model of ALL_STRATA_MODELS) {
    const m = nativeProFiles(model.id)
    const count =
      model.family === 'qwen36'
        ? 1
        : model.family !== 'unsloth'
          ? 2
          : ['UD-IQ1_M', 'UD-Q2_0', 'UD-IQ2_XS'].includes(model.quant)
            ? 3
            : 4
    assert.equal(m.files.length, count)
    assert.equal(new Set(m.files).size, count)
    assert.deepEqual(Object.keys(m.fileMetadata), m.files)
    assert.match(m.repo, /^[\w.-]+\/[\w.-]+$/)
    assert.match(m.revision, /^[a-f0-9]{40}$/)
    for (const [index, file] of m.files.entries()) {
      assert.ok(!file.includes('..') && !file.includes('\\') && !file.startsWith('/'))
      if (count > 1)
        assert.ok(
          file.endsWith(
            `-${String(index + 1).padStart(5, '0')}-of-${String(count).padStart(5, '0')}.gguf`
          )
        )
      assert.ok(Number.isSafeInteger(m.fileMetadata[file].size) && m.fileMetadata[file].size > 0)
      assert.match(m.fileMetadata[file].sha256, /^[a-f0-9]{64}$/)
    }
    const total = Object.values(m.fileMetadata).reduce((sum, file) => sum + file.size, 0)
    assert.ok(Math.abs(total / 1e9 - model.gb) < 0.5, model.id)
    assert.equal(m.projector, m.projectorSource.file)
    assert.match(m.projectorSource.revision, /^[a-f0-9]{40}$/)
    assert.match(m.projectorSource.sha256, /^[a-f0-9]{64}$/)
    assert.ok(m.projectorSource.size > 0)
  }
})

test('v3.1 IQ4 paths use UD-IQ4_XS, while setup and config retain the catalog alias', () => {
  const model = getStrataModel('unsloth-ud-iq4_xs-v31')
  assert.equal(model.name, 'IQ4_XS')
  assert.equal(model.quant, 'UD-IQ4_XS-v31')
  const m = nativeProFiles('unsloth-ud-iq4_xs-v31')
  assert.equal(m.revision, 'd96201194f103c906994f283f504209dc8d2a10c')
  assert.deepEqual(
    m.files,
    [1, 2, 3, 4].map((i) => `UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-0000${i}-of-00004.gguf`)
  )
  for (const q of unslothQuants)
    assert.equal(nativeProFiles(`unsloth-${q.toLowerCase()}`).revision, m.revision)
})

test('legacy native layouts and original Q4 revision remain addressable', () => {
  for (const model of LEGACY_STRATA_MODELS) {
    if (model.family === 'qwen36') continue
    const m = nativeProFiles(model.id)
    const prefix =
      model.family === 'swift'
        ? 'Swift-Qwen3.8-Flash-Next-GSQ-RCO'
        : model.family === 'unsloth'
          ? 'Qwen3.8-Flash-Next'
          : 'Qwen3.8-Flash-Next-GSQ-RCO'
    const count = model.family === 'unsloth' ? 4 : 2
    assert.deepEqual(
      m.files,
      Array.from(
        { length: count },
        (_, i) =>
          `${model.family === 'swift' ? '' : `${model.quant}/`}${prefix}-${model.quant}-0000${i + 1}-of-0000${count}.gguf`
      )
    )
  }
  const q4 = nativeProFiles('unsloth-ud-q4_k_xl')
  assert.equal(q4.revision, '38bb39ee97821de2c9009abb7e93950eec396e66')
  assert.equal(q4.fileMetadata[q4.files[0]].size, 10946624)
  assert.equal(
    q4.fileMetadata[q4.files[0]].sha256,
    '4448186216b3af4cc558bbce2c3213f01608f8f8b2e5267a9767971dd3ec8082'
  )
})

test('Qwen3.6 uses single GGUFs and its own pinned F16 encoder', () => {
  for (const [index, q] of qwen36Quants.entries()) {
    const m = nativeProFiles(`qwen36-${q.toLowerCase()}`)
    const file = `Qwen3.6-35B-A3B-${q}.gguf`
    assert.equal(m.repo, 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF')
    assert.equal(m.revision, '5bc3e238d916f48a861bac2f8a1990a0e9b7e98d')
    assert.deepEqual(m.files, [file])
    assert.equal(m.fileMetadata[file].size, [22853663008, 32611711264, 37801097504][index])
    assert.equal(m.projector, 'mmproj-F16.gguf')
    assert.equal(m.projectorSource.repo, m.repo)
    assert.equal(m.projectorSource.revision, m.revision)
    assert.equal(m.projectorSource.size, 899283584)
  }
})

test('Unsloth Flash-Next projectors explicitly name the separate ISTA repository and revision', () => {
  for (const model of STRATA_MODELS.filter(({ family }) => family === 'unsloth')) {
    assert.deepEqual(nativeProFiles(model.id).projectorSource, {
      repo: 'ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF',
      revision: 'ed59f92082b1e93c0e96d60a8b11aab089b52f09',
      file: 'mmproj-Qwen3.8-Flash-Next-BF16.gguf',
      size: 907543008,
      sha256: 'b1a82259702816a5330d7bd7607cd9676b11780e79ff7348c21103ff3ce49bd0'
    })
  }
})

test('mutating a returned native manifest cannot corrupt the pinned catalog', () => {
  const before = nativeProFiles(DEFAULT_STRATA_SETTINGS.model)
  const edited = nativeProFiles(DEFAULT_STRATA_SETTINGS.model)
  edited.files.push('untrusted.gguf')
  edited.fileMetadata[before.files[0]].size = 1
  edited.projectorSource.sha256 = 'corrupt'
  assert.deepEqual(nativeProFiles(DEFAULT_STRATA_SETTINGS.model), before)
})

test('PC requirements preserve each approved RAM/VRAM combination rather than summing model bytes', () => {
  const requirements = [
    'RAM+VRAM 48GB+8GB',
    'RAM+VRAM 48GB+12GB / RAM+VRAM 64GB+8GB',
    'RAM+VRAM 48GB+12GB / RAM+VRAM 64GB+8GB',
    'RAM+VRAM 48GB+16GB / RAM+VRAM 64GB+12GB',
    'RAM+VRAM 48GB+16GB / RAM+VRAM 64GB+12GB',
    'RAM+VRAM 64GB+16GB / RAM+VRAM 96GB+12GB',
    'RAM+VRAM 96GB+12GB',
    'RAM+VRAM 48GB+12GB',
    'RAM+VRAM 48GB+12GB'
  ]
  for (const platform of ['win32', 'linux']) {
    assert.deepEqual(
      STRATA_MODELS.map((model) => strataHardwareRecommendation(model, platform)),
      requirements
    )
  }
})

test('Mac recommendations remain separate from PC disk-streaming requirements', () => {
  for (const platform of ['darwin']) {
    let previous = 0
    for (const model of [...ALL_STRATA_MODELS].sort((a, b) => a.gb - b.gb)) {
      const label = strataHardwareRecommendation(model, platform)
      const match = label.match(
        platform === 'darwin' ? /^UMA (\d+)GB$/ : /^RAM\+VRAM (\d+)GB\+12GB$/
      )
      assert.ok(match, label)
      const memory = Number(match[1])
      const weightsGiB = (model.gb * 1e9) / 1024 ** 3
      assert.ok(memory >= weightsGiB + Math.max(12, weightsGiB * 0.15))
      assert.ok(memory >= model.ram && memory >= previous)
      previous = memory
    }
  }
  assert.equal(
    strataHardwareRecommendation(getStrataModel('qwen36-ud-q4_k_xl'), 'darwin'),
    'UMA 48GB'
  )
  assert.equal(strataHardwareRecommendation(getStrataModel('qwen36-q8_0'), 'darwin'), 'UMA 64GB')
  assert.equal(
    strataHardwareRecommendation(getStrataModel('unsloth-ud-q4_k_xl'), 'darwin'),
    'UMA 128GB'
  )
})

test('diagnostics prioritize the engine actually in use', () => {
  assert.equal(useProDiagnostics('standard', 'pro', true, true), false)
  assert.equal(useProDiagnostics('pro', 'standard', true, true), true)
  assert.equal(useProDiagnostics(null, undefined, false, true), true)
  assert.equal(useProDiagnostics(null, undefined, true, false), false)
  assert.equal(useProDiagnostics(null, 'pro', true, false), true)
  assert.equal(useProDiagnostics(null, undefined, false, false), false)
})

test('native arguments retain official llama.cpp contract for all new and legacy models', () => {
  for (const model of ALL_STRATA_MODELS) {
    for (const backend of ['auto', 'metal', 'cpu']) {
      for (const [kv, k, v] of [
        ['int8', 'q8_0', 'q8_0'],
        ['q4_0', 'q4_0', 'q4_0'],
        ['k8v4', 'q8_0', 'q4_0']
      ]) {
        const saved = Object.freeze({
          ...DEFAULT_STRATA_SETTINGS,
          model: model.id,
          backend,
          context: 20000,
          kv
        })
        const args = nativeProArgs(saved, '/pro/model.gguf')
        for (const [flag, expected] of [
          ['--model', '/pro/model.gguf'],
          ['--ctx-size', '20000'],
          ['--parallel', '1'],
          ['--port', '18882'],
          ['--host', '127.0.0.1'],
          ['--alias', model.name.startsWith('lite_') ? `aurapro-pro,${model.name}` : 'aurapro-pro'],
          ['--n-gpu-layers', backend === 'cpu' ? '0' : '99'],
          ['--cache-type-k', k],
          ['--cache-type-v', v],
          ['--flash-attn', 'auto']
        ])
          assert.equal(option(args, flag), expected)
        assert.deepEqual(JSON.parse(option(args, '--chat-template-kwargs')), {
          enable_thinking: false
        })
        assert.ok(args.includes('--jinja'))
        for (const flag of ['--mtp', '--draft', '--native', '--pack', '--mmproj'])
          assert.ok(!args.includes(flag))
      }
    }
    const settings = { ...DEFAULT_STRATA_SETTINGS, model: model.id, vision: true }
    assert.throws(() => nativeProArgs(settings, '/model'), /projector/)
    assert.equal(option(nativeProArgs(settings, '/model', '/projector'), '--mmproj'), '/projector')
  }
  for (const backend of ['cuda', 'hip'])
    assert.throws(
      () => nativeProArgs({ ...DEFAULT_STRATA_SETTINGS, backend }, '/model'),
      /Metal or CPU/
    )
})

const controlDir =
  process.env.STRATA_CONTROL_DIR ||
  path.resolve(import.meta.dirname, '../../.tmp/strata-0.2.15-check/control')
const controlPython =
  process.env.STRATA_CONTROL_PYTHON ||
  path.join(controlDir, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3')
const controlAvailable = existsSync(path.join(controlDir, 'setup.py')) && existsSync(controlPython)

test(
  'catalog matches pinned Control tables and setup parser offline, without downloading or preparing models',
  {
    skip:
      !controlAvailable && !process.env.STRATA_CONTROL_DIR && !process.env.STRATA_CONTROL_PYTHON
        ? 'Set STRATA_CONTROL_DIR and STRATA_CONTROL_PYTHON to verify the pinned upstream bundle'
        : false
  },
  () => {
    assert.ok(controlAvailable, `Missing Control bundle/interpreter: ${controlDir}`)
    assert.equal(readFileSync(path.join(controlDir, 'VERSION'), 'utf8').trim(), '0.1.61')
    assert.equal(readFileSync(path.join(controlDir, 'COMMIT'), 'utf8').trim(), STRATA_SOURCE)
    const selected = ALL_STRATA_MODELS.map((m) => ({
      ...m,
      selectable: STRATA_MODELS.some(({ id }) => id === m.id),
      // This fixture deliberately verifies the old Control parser and saved model layouts.
      setupArgs: [
        ...strataSetupArgs(
          { ...DEFAULT_STRATA_SETTINGS, model: m.id, backend: 'hip', vision: true },
          'C:/Models/Pro data'
        ),
        '--source',
        'huggingface'
      ]
    }))
    const result = spawnSync(
      controlPython,
      [
        '-B',
        '-c',
        String.raw`
import argparse, json, runpy, socket, sys
def forbidden(*args, **kwargs):
    raise AssertionError('Catalog test must not download or run setup')
socket.create_connection = forbidden
socket.socket.connect = forbidden
sys.path.insert(0, sys.argv[1])
import setup as s
s.CONTROL = True
checked_urls = []
s.download = lambda url, *args: checked_urls.append(url)
managed = runpy.run_path('resources/strata_adapter.py')
managed['configure_managed_setup'](s)
from strata_control import private_files
private_files.adopt_user_defaults = lambda: None
class ParsedOnly(Exception):
    pass
original_parse = argparse.ArgumentParser.parse_args
parsed_args = []
def parse_only(parser, *args, **kwargs):
    parsed_args.append(vars(original_parse(parser, *args, **kwargs)))
    raise ParsedOnly()
argparse.ArgumentParser.parse_args = parse_only
out = {}
for item in json.loads(sys.argv[2]):
    family, quant = item['family'], item['quant']
    own = family in s.OWN_PATH_FAMILIES
    fam = (s.OWN_PATH_FAMILIES if own else s.FAMILIES)[family]
    base = fam['hf'] if own else s.model_hf(fam, quant)
    prefix = s.HF_FILE.match(base + 'x')
    names = [fam['file'].format(q=quant)] if own else [s.model_file(fam, quant, i)
        for i in range(1, s.MODELS[quant].get('shards', fam.get('shards', 2)) + 1)]
    files, metadata = [], {}
    for name in names:
        url = base + name
        if item['selectable']:
            s.download(url, None)
        file = s.HF_FILE.match(url).group('path')
        size, sha = s.file_pin(url)
        files.append(file)
        metadata[file] = {'size': size, 'sha256': sha}
    proj = s.HF_FILE.match(fam['mmproj_hf'] + fam['mmproj'])
    if item['selectable']:
        s.download(proj.group(0), None)
    size, sha = s.file_pin(proj.group(0))
    manifest = {'repo': prefix.group('repo'), 'revision': prefix.group('rev'), 'files': files,
        'fileMetadata': metadata, 'projector': proj.group('path'),
        'projectorSource': {'repo': proj.group('repo'), 'revision': proj.group('rev'), 'file': proj.group('path'), 'size': size, 'sha256': sha}}
    sys.argv = ['setup.py', *item['setupArgs']]
    try:
        s.main()
    except ParsedOnly:
        pass
    else:
        raise AssertionError('Setup must stop at argument parsing')
    parsed = parsed_args[-1]
    assert parsed['family'] == family and parsed['model'] == quant
    assert parsed['setup'] and parsed['no_start'] and parsed['yes']
    assert parsed['source'] == 'huggingface' and parsed['browser'] is False
    assert parsed['backend'] == 'hip' and parsed['vision'] == 'yes'
    assert parsed['models_dir'] == 'C:/Models/Pro data/models'
    info = fam['models'][quant] if own else s.MODELS[quant]
    out[item['id']] = {'manifest': manifest, 'config': 'strata-' + (fam['tag'] + quant).lower() + '.json', 'ram': info['ram_gb']}
assert checked_urls
print(json.dumps(out))
`,
        controlDir,
        JSON.stringify(selected)
      ],
      {
        encoding: 'utf8',
        timeout: 30000,
        windowsHide: true,
        env: {
          ...process.env,
          HF_ENDPOINT: 'https://huggingface.co',
          STRATA_FEED_MODELS: '0',
          PYTHONDONTWRITEBYTECODE: '1'
        }
      }
    )
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const upstream = JSON.parse(result.stdout)
    for (const model of ALL_STRATA_MODELS) {
      assert.deepEqual(nativeProFiles(model.id), upstream[model.id].manifest, model.id)
      assert.equal(strataConfigName(model.id), upstream[model.id].config, model.id)
      if (LEGACY_STRATA_MODELS.some((legacy) => legacy.id === model.id))
        assert.equal(model.ram, upstream[model.id].ram, model.id)
    }
  }
)

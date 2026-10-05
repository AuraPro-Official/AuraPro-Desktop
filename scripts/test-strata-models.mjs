import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_STRATA_SETTINGS,
  STRATA_MODELS,
  strataConfigName,
  strataHardwareRecommendation,
  useProDiagnostics,
  strataSetupArgs,
  nativeProFiles,
  nativeProArgs,
  validateStrataSettings
} from '../src/main/utils/strata-models.ts'

test('all managed presets have a distinct upstream configuration', () => {
  assert.equal(STRATA_MODELS.length, 8)
  assert.deepEqual(
    STRATA_MODELS.map((model) => model.name),
    ['Q2', 'IQ2_XS', 'IQ3_XXS', 'IQ3_S', 'Swift IQ2_XS', 'Swift IQ3_XXS', 'Coder IQ1_M', 'Q4']
  )
  assert.equal(new Set(STRATA_MODELS.map((model) => strataConfigName(model.id))).size, 8)
  assert.equal(strataConfigName('qwen-iq2_xs'), 'strata-iq2_xs.json')
  assert.equal(strataConfigName('swift-iq2_xs'), 'strata-swift-iq2_xs.json')
})

test('all Pro presets carry consistent discrete GPU recommendations, without unsupported UMA claims', () => {
  for (const model of STRATA_MODELS) {
    const label = strataHardwareRecommendation(model)
    const expected =
      model.family === 'unsloth'
        ? 'RAM+VRAM 64GB+16GB'
        : model.family === 'coder'
          ? 'RAM+VRAM 48GB+8GB / 32GB+12GB'
          : ['Q2_0', 'IQ2_XS'].includes(model.quant)
            ? 'RAM+VRAM 64GB+8GB / 48GB+12GB'
            : 'RAM+VRAM 64GB+12GB'
    assert.equal(label, expected)
    assert.ok(!label.includes('UMA'))
  }
})

test('diagnostics accept either runtime and prioritize the engine actually in use', () => {
  assert.equal(useProDiagnostics('standard', 'pro', true, true), false)
  assert.equal(useProDiagnostics('pro', 'standard', true, true), true)
  assert.equal(useProDiagnostics(null, undefined, false, true), true)
  assert.equal(useProDiagnostics(null, undefined, true, false), false)
  assert.equal(useProDiagnostics(null, 'pro', true, false), true)
  assert.equal(useProDiagnostics(null, undefined, false, false), false)
})

test('setup remains non-interactive, loopback-only and does not start the model', () => {
  const args = strataSetupArgs(DEFAULT_STRATA_SETTINGS, 'C:/Models/Pro data')
  assert.ok(args.includes('--no-start'))
  assert.ok(args.includes('--yes'))
  assert.equal(args[args.indexOf('--port') + 1], '18882')
  assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1')
  assert.equal(args[args.indexOf('--data-dir') + 1], 'C:/Models/Pro data')
  assert.ok(!args.includes('--build'))
})

test('settings reject unknown models, unsafe context and unsupported Q4 combinations', () => {
  for (const settings of [
    { model: '../../untrusted' },
    { context: NaN },
    { context: 0 },
    { context: 9999999 },
    { kv: 'f16' },
    { backend: 'invalid' },
    { vision: 'yes' },
    { model: 'unsloth-ud-q4_k_xl', vision: true },
    { model: 'unsloth-ud-q4_k_xl', backend: 'hip' }
  ])
    assert.throws(() => validateStrataSettings({ ...DEFAULT_STRATA_SETTINGS, ...settings }))
})

test('Mac Pro keeps all presets, split GGUFs and independent llama.cpp arguments', () => {
  for (const model of STRATA_MODELS) {
    const manifest = nativeProFiles(model.id)
    assert.equal(manifest.files.length, model.family === 'unsloth' ? 4 : 2)
    assert.match(manifest.files[0], /00001-of-0000[24]\.gguf$/)
    assert.match(manifest.revision, /^[a-f0-9]{40}$/)
    assert.match(strataHardwareRecommendation(model, 'darwin'), /^UMA (80|96|128)GB$/)
    const settings = {
      ...DEFAULT_STRATA_SETTINGS,
      model: model.id,
      backend: 'metal',
      context: 20000
    }
    const args = nativeProArgs(settings, '/pro/model.gguf')
    for (const [key, value] of [
      ['--ctx-size', '20000'],
      ['--parallel', '1'],
      ['--port', '18882'],
      ['--alias', 'aurapro-pro'],
      ['--cache-type-k', 'q8_0']
    ])
      assert.equal(args[args.indexOf(key) + 1], value)
    assert.ok(!args.includes('--draft'))
    assert.throws(() => strataSetupArgs(settings, '/pro'))
    const cpu = nativeProArgs({ ...settings, backend: 'cpu', kv: 'k8v4' }, '/pro/model.gguf')
    assert.equal(cpu[cpu.indexOf('--n-gpu-layers') + 1], '0')
    assert.equal(cpu[cpu.indexOf('--cache-type-v') + 1], 'q4_0')
  }
  assert.throws(() => nativeProArgs({ ...DEFAULT_STRATA_SETTINGS, backend: 'cuda' }, '/model'))
  assert.throws(() => nativeProArgs({ ...DEFAULT_STRATA_SETTINGS, vision: true }, '/model'))
  assert.ok(
    nativeProArgs({ ...DEFAULT_STRATA_SETTINGS, vision: true }, '/model', '/projector').includes(
      '--mmproj'
    )
  )
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_STRATA_SETTINGS,
  STRATA_MODELS,
  strataConfigName,
  strataHardwareRecommendation,
  useProDiagnostics,
  strataSetupArgs,
  validateStrataSettings
} from '../src/main/utils/strata-models.ts'

test('all managed presets have a distinct upstream configuration', () => {
  assert.equal(STRATA_MODELS.length, 8)
  assert.equal(new Set(STRATA_MODELS.map((model) => strataConfigName(model.id))).size, 8)
  assert.equal(strataConfigName('qwen-iq2_xs'), 'strata-iq2_xs.json')
  assert.equal(strataConfigName('swift-iq2_xs'), 'strata-swift-iq2_xs.json')
})

test('all Pro presets carry consistent discrete GPU recommendations, without unsupported UMA claims', () => {
  for (const model of STRATA_MODELS) {
    const label = strataHardwareRecommendation(model)
    assert.match(label, /^RAM\+VRAM (32|48|64)GB\+12GB$/)
    assert.ok(Number(label.match(/ (\d+)GB/)[1]) >= model.ram)
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
    { backend: 'metal' },
    { vision: 'yes' },
    { model: 'unsloth-ud-q4_k_xl', vision: true },
    { model: 'unsloth-ud-q4_k_xl', backend: 'hip' }
  ])
    assert.throws(() => validateStrataSettings({ ...DEFAULT_STRATA_SETTINGS, ...settings }))
})

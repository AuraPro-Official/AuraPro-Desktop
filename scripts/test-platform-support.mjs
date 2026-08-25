import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getBundledPythonTarget,
  getLlamaAssetPatterns,
  getSupportedLlamaVariants,
  isBundledPythonMachineCompatible,
  matchesAssetPattern,
  normalizeLlamaVariantForPlatform
} from '../src/main/utils/platform-support.ts'

const targets = [
  ['win32', 'x64', 'x86_64-pc-windows-msvc'],
  ['win32', 'arm64', 'x86_64-pc-windows-msvc'],
  ['darwin', 'x64', 'x86_64-apple-darwin'],
  ['darwin', 'arm64', 'aarch64-apple-darwin'],
  ['linux', 'x64', 'x86_64-unknown-linux-gnu'],
  ['linux', 'arm64', 'aarch64-unknown-linux-gnu']
]

test('selects a resolvable bundled Python target for all desktop packages', () => {
  for (const [platform, architecture, expected] of targets) {
    assert.equal(getBundledPythonTarget(platform, architecture), expected)
  }
})

test('uses x64 Python through Windows 11 Arm emulation', () => {
  assert.equal(isBundledPythonMachineCompatible('win32', 'arm64', 'AMD64'), true)
  assert.equal(isBundledPythonMachineCompatible('win32', 'arm64', 'ARM64'), false)
})

test('only exposes llama.cpp variants that have supported runtime assets', () => {
  assert.deepEqual(getSupportedLlamaVariants('win32', 'arm64'), ['cpu'])
  assert.deepEqual(getSupportedLlamaVariants('linux', 'arm64'), ['cpu', 'vulkan'])
  assert.deepEqual(getSupportedLlamaVariants('linux', 'x64'), ['cpu', 'vulkan', 'rocm'])
  assert.equal(normalizeLlamaVariantForPlatform('cuda-13.3', 'win32', 'arm64'), 'cpu')
  assert.equal(normalizeLlamaVariantForPlatform('rocm', 'linux', 'arm64'), 'cpu')
})

test('selects architecture-specific llama.cpp assets on all six targets', () => {
  const tag = 'b10603'
  const expected = [
    ['win32', 'x64', 'cpu', `llama-${tag}-bin-win-cpu-x64.zip`],
    ['win32', 'arm64', 'cpu', `llama-${tag}-bin-win-cpu-arm64.zip`],
    ['darwin', 'x64', 'cpu', `llama-${tag}-bin-macos-x64.tar.gz`],
    ['darwin', 'arm64', 'cpu', `llama-${tag}-bin-macos-arm64.tar.gz`],
    ['linux', 'x64', 'cpu', `llama-${tag}-bin-ubuntu-x64.tar.gz`],
    ['linux', 'arm64', 'vulkan', `llama-${tag}-bin-ubuntu-vulkan-arm64.tar.gz`]
  ]

  for (const [platform, architecture, variant, assetName] of expected) {
    const selection = getLlamaAssetPatterns(tag, variant, platform, architecture)
    assert.equal(
      selection.patterns.some((pattern) => matchesAssetPattern(assetName, pattern)),
      true
    )
  }
})

test('accepts the current ROCm version without hard-coding it', () => {
  const [pattern] = getLlamaAssetPatterns('b10603', 'rocm', 'linux', 'x64').patterns
  assert.equal(matchesAssetPattern('llama-b10603-bin-ubuntu-rocm-7.14-x64.tar.gz', pattern), true)
})

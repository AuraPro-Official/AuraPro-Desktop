import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseFirstPresetModelId,
  readArgValue,
  resolveEpubConceptModelHint
} from '../src/main/utils/epub-concept-hint.ts'

const noPreset = () => {
  throw new Error('the preset reader must not run unless --models-preset is configured')
}

const preset = (contents) => (presetPath) => {
  assert.equal(presetPath, '/deployer/custom.ini')
  return contents
}

const deployerPreset = preset(
  '[*]\nctx-size = 4096\n\n[deployer-choice]\nmodel = /srv/a.gguf\n\n[second]\nmodel = /srv/b.gguf\n'
)

test('a Desktop-managed preset hints at its first model, and at nothing when empty', () => {
  assert.equal(
    resolveEpubConceptModelHint([], ['first-model', 'second-model'], noPreset),
    'first-model'
  )
  assert.equal(resolveEpubConceptModelHint([], [], noPreset), null)
  assert.equal(
    resolveEpubConceptModelHint(['--ctx-size', '8192', '-ngl', '99'], ['first-model'], noPreset),
    'first-model'
  )
})

test('an explicit model outranks the generated preset in every spelling', () => {
  const fallback = ['first-model']

  assert.equal(
    resolveEpubConceptModelHint(['--model', '/models/My Model.Q4.gguf'], fallback, noPreset),
    'My Model.Q4'
  )
  assert.equal(resolveEpubConceptModelHint(['--model=/models/foo.gguf'], fallback, noPreset), 'foo')
  assert.equal(resolveEpubConceptModelHint(['-m', '/models/bar.GGUF'], fallback, noPreset), 'bar')
  assert.equal(
    resolveEpubConceptModelHint(['-m', 'C:\\models\\baz.gguf'], fallback, noPreset),
    'baz'
  )
  assert.equal(
    resolveEpubConceptModelHint(
      ['--model', '/m/a.gguf', '--model', '/m/b.gguf'],
      fallback,
      noPreset
    ),
    'b'
  )
})

test('an alias outranks an explicit model because it is the id the server reports', () => {
  assert.equal(
    resolveEpubConceptModelHint(['--model', '/m/x.gguf', '--alias', 'my-alias'], [], noPreset),
    'my-alias'
  )
  assert.equal(
    resolveEpubConceptModelHint(['-m', '/m/x.gguf', '--alias=team-llm'], [], noPreset),
    'team-llm'
  )
  assert.equal(
    resolveEpubConceptModelHint(['-a', 'short-alias', '-m', '/m/x.gguf'], [], noPreset),
    'short-alias'
  )
})

test('a deployer-supplied preset is read instead of the generated one', () => {
  assert.equal(
    resolveEpubConceptModelHint(
      ['--models-preset', '/deployer/custom.ini'],
      ['first-model'],
      deployerPreset
    ),
    'deployer-choice'
  )
  assert.equal(
    resolveEpubConceptModelHint(['--models-preset=/deployer/custom.ini'], [], deployerPreset),
    'deployer-choice'
  )
  assert.equal(
    resolveEpubConceptModelHint(['--models-preset', '/deployer/custom.ini'], [], preset(null)),
    null
  )
  assert.equal(
    resolveEpubConceptModelHint(
      ['--models-preset', '/deployer/custom.ini'],
      ['first-model'],
      preset('[*]\nctx-size = 4096\n')
    ),
    null
  )
})

test('preset sections survive CRLF endings and escaped brackets', () => {
  assert.equal(
    parseFirstPresetModelId('[*]\r\nctx-size = 4096\r\n\r\n[win-model]\r\nmodel = C:/m/a.gguf\r\n'),
    'win-model'
  )
  assert.equal(parseFirstPresetModelId('[*]\n\n[odd\\]name]\nmodel = /srv/c.gguf\n'), 'odd]name')
  assert.equal(parseFirstPresetModelId(''), null)
})

test('a model flag without a usable value falls back to the generated preset', () => {
  // llama.cpp still receives the generated --models-preset in this branch, so
  // its ids remain the truthful hint even though --model parses to nothing.
  assert.equal(resolveEpubConceptModelHint(['--model'], ['first-model'], noPreset), 'first-model')
  assert.equal(
    resolveEpubConceptModelHint(['--model', '--verbose'], ['first-model'], noPreset),
    'first-model'
  )
})

test('a long option is never mistaken for a shorter one that prefixes it', () => {
  assert.equal(readArgValue(['--models-preset', '/deployer/custom.ini'], ['--model', '-m']), null)
  assert.equal(readArgValue(['--models-preset=/deployer/custom.ini'], ['--model', '-m']), null)
  assert.equal(
    readArgValue(['--models-preset', '/deployer/custom.ini'], ['--models-preset']),
    '/deployer/custom.ini'
  )
})

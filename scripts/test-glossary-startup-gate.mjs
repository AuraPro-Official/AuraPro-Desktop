import assert from 'node:assert/strict'
import test from 'node:test'
import { GlossaryStartupGate } from '../src/main/utils/glossary-startup-gate.ts'

test('startup waits until dismissed; concurrent callers share the same prompt', async () => {
  const gate = new GlossaryStartupGate()
  let completed = false
  const waiting = gate.wait()
  assert.equal(gate.wait(), waiting)
  waiting.then(() => {
    completed = true
  })
  await Promise.resolve()
  assert.equal(completed, false)
  assert.equal(gate.pending, true)
  gate.finish()
  await waiting
  assert.equal(completed, true)
  assert.equal(gate.pending, false)
})

test('closing a prompt does not disable the prompt for the next startup', async () => {
  const gate = new GlossaryStartupGate()
  const first = gate.wait()
  gate.finish()
  await first
  const second = gate.wait()
  assert.notEqual(second, first)
  assert.equal(gate.pending, true)
  gate.finish()
  gate.finish()
  await second
})

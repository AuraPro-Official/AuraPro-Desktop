import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('removed terminal service cannot be installed, started or exposed through IPC', () => {
  assert.equal(existsSync(new URL('src/main/utils/open-terminal.ts', root)), false)
  for (const file of [
    'src/main/index.ts',
    'src/main/utils/index.ts',
    'src/main/utils/llamacpp-diagnostics.ts',
    'src/preload/index.ts',
    'src/renderer/src/lib/components/Main/Connections.svelte',
    'src/renderer/src/lib/components/Main/Connections/GetStartedModal.svelte',
    'src/renderer/src/lib/components/Main/Settings.svelte',
    'src/renderer/src/lib/components/Setup/LocalInstall.svelte'
  ]) {
    assert.doesNotMatch(read(file), /open-terminal|openTerminal|OpenTerminal/)
  }
})

test('removed service has no settings page or translated configuration entries', () => {
  assert.equal(
    existsSync(new URL('src/renderer/src/lib/components/Main/Settings/OpenTerminal.svelte', root)),
    false
  )
  const locales = 'src/renderer/src/lib/i18n/locales/'
  for (const locale of readdirSync(new URL(locales, root))) {
    if (!existsSync(new URL(`${locales}${locale}/translation.json`, root))) continue
    const entries = JSON.parse(read(`${locales}${locale}/translation.json`))
    assert.ok(!Object.keys(entries).some((key) => /openTerminal|settings\.terminal\./i.test(key)))
  }
})

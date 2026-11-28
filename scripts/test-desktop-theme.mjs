import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { desktopThemeFromWebUI, normalizeDesktopTheme } from '../src/shared/desktop-theme.ts'

test('desktop and WebUI theme values use the same three desktop modes', () => {
  assert.equal(normalizeDesktopTheme(undefined), 'system')
  assert.equal(normalizeDesktopTheme('unrecognized'), 'system')
  assert.equal(normalizeDesktopTheme('dark'), 'dark')
  assert.equal(normalizeDesktopTheme('light'), 'light')
  assert.equal(desktopThemeFromWebUI('oled-dark'), 'dark')
  assert.equal(desktopThemeFromWebUI('her'), 'light')
  assert.equal(desktopThemeFromWebUI('system'), 'system')
  assert.equal(desktopThemeFromWebUI({}), undefined)
})

test('loading a guest requests the desktop theme without writing its old preference', () => {
  const source = readFileSync(new URL('../src/preload/content-preload.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  })
  const world = {}
  const events = new Map()
  const messages = []
  const electron = {
    contextBridge: { exposeInMainWorld: (key, value) => (world[key] = value) },
    ipcRenderer: {
      on: (channel, callback) => events.set(channel, callback),
      sendToHost: (channel, payload) => messages.push([channel, payload.type, payload.data.theme])
    }
  }
  let storedTheme = 'dark'
  runInNewContext(outputText, {
    exports: {},
    require: () => electron,
    navigator: {},
    localStorage: { getItem: () => storedTheme }
  })

  world.applyTheme()
  assert.deepEqual(messages, [])
  const delivered = []
  world.electronAPI.onEvent((event) => delivered.push(event))
  assert.deepEqual(messages, [['webview:event', 'theme:ready', 'dark']])
  const desktopUpdate = { type: 'theme:update', data: { theme: 'light' } }
  events.get('desktop:event')(null, desktopUpdate)
  assert.deepEqual(delivered, [desktopUpdate])
  assert.equal(messages.length, 1)

  storedTheme = 'oled-dark'
  world.applyTheme()
  assert.deepEqual(messages.at(-1), ['webview:event', 'theme:change', 'oled-dark'])
})

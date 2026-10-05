import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createServer } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import {
  STRATA_MODELS,
  DEFAULT_STRATA_SETTINGS,
  strataHardwareRecommendation
} from '../src/main/utils/strata-models.ts'

const require = createRequire(import.meta.url)
const playwrightPath = require.resolve('playwright', {
  paths: [process.cwd(), path.join(path.dirname(process.execPath), '..', 'node_modules')]
})
const { chromium } = require(playwrightPath)
const fixture = {
  supported: true,
  status: 'stopped',
  error: '',
  logs: '',
  installed: { version: 'test', source: 'test' },
  port: 18882,
  settings: DEFAULT_STRATA_SETTINGS,
  models: STRATA_MODELS.map((model) => ({
    ...model,
    ramInfo: strataHardwareRecommendation(model),
    installed: false,
    experimental: model.family === 'unsloth'
  }))
}
const server = await createServer({
  configFile: false,
  appType: 'custom',
  root: process.cwd(),
  plugins: [svelte(), tailwindcss()],
  server: { host: '127.0.0.1', port: 0 }
})
server.middlewares.use('/__pro_test', async (_req, res) => {
  const html = await server.transformIndexHtml(
    '/__pro_test',
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="app" style="max-width:850px;padding:24px;margin:auto"></main><script type="module">
  import { mount } from 'svelte';
  import Pro from '/src/renderer/src/lib/components/Main/Settings/InferencePro.svelte';
  import { initI18n } from '/src/renderer/src/lib/i18n/index.ts';
  import '/src/renderer/src/app.css';
  const info = ${JSON.stringify(fixture)};
  window.calls = [];
  window.electronAPI = {
    getStrataInfo: async () => structuredClone(info),
    saveStrataSettings: async (settings) => { window.calls.push(['save',settings]); info.settings=settings; },
    prepareStrataModel: async (settings) => { window.calls.push(['prepare',settings]); },
    installStrata: async () => {}, checkStrataUpdate: async () => ({ version:'test-next' }),
    startStrata: async () => { info.status='started'; }, stopStrata: async () => { info.status='stopped'; },
    cancelStrataOperation: async () => {}
  };
  initI18n();
  mount(Pro, {target:document.getElementById('app')});
  </script></body></html>`
  )
  res.setHeader('Content-Type', 'text/html')
  res.end(html)
})
let browser
server.middlewares.use('/__setup_test', async (_req, res) => {
  const html = await server.transformIndexHtml(
    '/__setup_test',
    `<!doctype html>
  <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body><main id="app" style="max-width:850px;margin:auto;padding:24px"></main><script type="module">
  import { mount } from 'svelte';
  import Setup from '/src/renderer/src/lib/components/Setup/LocalInstall.svelte';
  import { initI18n } from '/src/renderer/src/lib/i18n/index.ts';
  import '/src/renderer/src/app.css';
  let config = {llamaCpp:{enabled:true}, localServer:{}, sherpa:{}, openCode:{}};
  const info = ${JSON.stringify(fixture)};
  info.installed = null;
  window.calls = [];
  window.completed = false;
  const api = {
    getInstallDir: async () => '/test/install',
    getDiskSpace: async () => ({free:1024**4}),
    checkInstallPreflight: async () => ({pathSupported:true,writable:true,enoughSpace:true}),
    getSystemInfo: async () => ({totalMemGB:64,dedicatedVramGB:12,architecture:'x64'}),
    getStrataInfo: async () => structuredClone(info),
    getConfig: async () => structuredClone(config),
    setConfig: async patch => {config={...config,...patch};},
    getPythonStatus: async () => true,
    getOpenTerminalStatus: async () => true,
    getServerInfo: async () => ({reachable:true,url:'http://127.0.0.1:8081'}),
    getConnections: async () => [],
    onData: () => () => {},
    connectTo: async () => true,
    startLlamaCpp: async () => ({url:'http://127.0.0.1:18881'})
  };
  window.electronAPI = new Proxy(api, {get(target,key) {
    return async (...args) => {window.calls.push([key,...args]); return key in target ? target[key](...args) : true;};
  }});
  initI18n();
  mount(Setup,{target:document.getElementById('app'),props:{autoStart:true,onBack:()=>{},onComplete:()=>{window.completed=true;}}});
  </script></body></html>`
  )
  res.setHeader('Content-Type', 'text/html')
  res.end(html)
})
try {
  await server.listen()
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PRO_TEST_BROWSER || 'chrome'
  })
  const port = server.httpServer.address().port
  const screenshots = path.resolve('../.tmp/pro-ui')
  await fs.mkdir(screenshots, { recursive: true })
  for (const proChoice of [true, false]) {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      viewport: { width: 640, height: 1000 }
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${port}/__setup_test?lang=zh-CN`)
    await page.getByRole('button', { name: 'Download & Finish Setup' }).waitFor()
    await page.locator('summary').click()
    assert.equal(await page.getByText(/^Pro_V1 · /).count(), 8)
    if (proChoice)
      await page.getByText('Pro_V1 · Qwen3.8-Flash-Next IQ2_XS', { exact: true }).click()
    await page.waitForTimeout(2200)
    await page.screenshot({
      path: path.join(screenshots, `setup-${proChoice ? 'pro' : 'standard'}.png`),
      fullPage: true
    })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    )
    await page.getByRole('button', { name: 'Download & Finish Setup' }).click()
    await page.waitForFunction(() => window.completed)
    const calls = await page.evaluate(() => window.calls)
    const names = calls.map((call) => call[0])
    assert.equal(names.includes('installStrata'), proChoice)
    assert.equal(names.includes('prepareStrataModel'), proChoice)
    assert.equal(names.includes('startStrata'), proChoice)
    assert.equal(names.includes('startLlamaCpp'), !proChoice)
    assert.equal(names.includes('downloadHfModel'), !proChoice)
    if (proChoice) {
      const selection = calls.find(
        (call) => call[0] === 'setConfig' && call[1].inferenceRuntime === 'pro'
      )
      assert.equal(selection[1].llamaCpp.enabled, false)
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  for (const [locale, width] of [
    ['zh-CN', 1100],
    ['zh-TW', 640],
    ['en-US', 640],
    ['es-ES', 640]
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } })
    const errors = []
    page.on('pageerror', (err) => {
      errors.push(err.message)
      console.error(err.message)
    })
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(message.text())
    })
    await page.goto(`http://127.0.0.1:${port}/__pro_test?lang=${locale}`)
    await page.locator('select').first().waitFor()
    await page.waitForTimeout(600)
    assert.equal(await page.locator('select').count(), 3)
    assert.equal(await page.locator('select').nth(1).locator('option').count(), 8)
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false
    )
    assert.equal(
      await page
        .locator('body')
        .innerText()
        .then((value) => value.includes('settings.pro.')),
      false
    )
    if (locale === 'zh-CN') {
      await page.locator('input[type=number]').fill('16384')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      assert.equal(await page.evaluate(() => window.calls[0][1].context), 16384)
      await page.getByRole('button', { name: '启动', exact: true }).click()
      await page.getByRole('button', { name: '停止', exact: true }).waitFor()
    }
    assert.deepEqual(errors, [])
    await page.screenshot({
      path: path.join(screenshots, `${locale}-${width}.png`),
      fullPage: true
    })
    await page.close()
  }
  console.log('Pro UI smoke passed: four locales, narrow/desktop layouts, save and start controls.')
} finally {
  await browser?.close()
  await server.close()
}

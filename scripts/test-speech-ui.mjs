import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createServer } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

const require = createRequire(import.meta.url)
const { chromium } = require(
  require.resolve('playwright', {
    paths: [process.cwd(), path.join(path.dirname(process.execPath), '..', 'node_modules')]
  })
)
const server = await createServer({
  configFile: false,
  appType: 'custom',
  root: process.cwd(),
  plugins: [svelte(), tailwindcss()],
  server: { host: '127.0.0.1', port: 0 }
})
server.middlewares.use('/__speech_test', async (_req, res) => {
  const html = await server.transformIndexHtml(
    '/__speech_test',
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="app" style="max-width:800px;padding:16px;margin:auto"></main><script type="module">
  import { mount } from 'svelte';
  import Speech from '/src/renderer/src/lib/components/Main/Settings/Speech.svelte';
  import { initI18n } from '/src/renderer/src/lib/i18n/index.ts';
  import '/src/renderer/src/app.css';
  window.configData = {locale:'zh-CN',sherpa:{enabledLanguages:['zh','en']}};
  window.calls = [];
  window.electronAPI = new Proxy({
    getConfig: async () => JSON.parse(JSON.stringify(window.configData)),
    setConfig: async (updates) => {window.configData={...window.configData,...JSON.parse(JSON.stringify(updates))};window.calls.push(updates);},
    getSherpaInfo: async () => ({version:'1.13.8',status:'stopped',languages:{zh:{asr:true,tts:true},en:{asr:true,tts:false}}}),
    getPackageVersion: async () => '1.13.8', listSherpaModels: async () => [],
    onMessage: () => () => {}, onData: () => () => {},
    downloadSherpaAsrModel: async () => {window.calls.push('download-asr');},
    downloadSherpaTTSModel: async () => {window.calls.push('download-tts');}
  }, {get: (object,key) => object[key] ?? (async () => undefined)});
  initI18n(); mount(Speech,{target:document.getElementById('app')});
  </script></body></html>`
  )
  res.setHeader('Content-Type', 'text/html')
  res.end(html)
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({
    headless: true,
    channel: process.env.SPEECH_TEST_BROWSER || 'chrome'
  })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__speech_test`, {
    timeout: 20000,
    waitUntil: 'domcontentloaded'
  })
  await page.locator('details[open] input[type=checkbox]').first().waitFor()
  assert.equal(await page.locator('details[open] input:checked').count(), 2)
  const labels = page.locator('details[open] label')
  const index = await labels.evaluateAll((items) =>
    items.findIndex((item) => !item.querySelector('input').checked)
  )
  const option = labels.nth(index).locator('input')
  await option.check()
  await page.waitForFunction(() => window.configData.sherpa.enabledLanguages.length === 3)
  await option.uncheck()
  await page.waitForFunction(() => window.configData.sherpa.enabledLanguages.length === 2)
  await fs.mkdir('.tmp-speech-ui', { recursive: true })
  for (const width of [1280, 640, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: `.tmp-speech-ui/speech-${width}.png`, fullPage: true })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `Horizontal overflow at ${width}`
    )
  }
  assert.deepEqual(errors, [])
  console.log('Speech language selection and responsive screenshots passed')
} finally {
  await browser?.close()
  await server.close()
}

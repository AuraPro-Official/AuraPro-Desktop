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
  import Settings from '/src/renderer/src/lib/components/Main/Settings.svelte';
  import { initI18n } from '/src/renderer/src/lib/i18n/index.ts';
  import { config } from '/src/renderer/src/lib/stores.ts';
  import '/src/renderer/src/app.css';
  window.configData = {
    locale:'zh-CN', runInBackground:true,
    localServer:{enabled:true,version:'3.10.19'}, llamaCpp:{enabled:false,kvCacheType:'q8_0',extraArgs:['--no-mmap']},
    sherpa:{enabledLanguages:['zh','en'],asrProfiles:{zh:{model:'custom.onnx'}},ttsProfiles:{en:{model:'custom-voice.onnx'}}}
  };
  window.calls = [];
  window.holdDownload = false;
  window.rejectSave = false;
  window.electronAPI = new Proxy({
    getConfig: async () => structuredClone(window.configData),
    setConfig: async (updates) => {
      const data = structuredClone(updates);
      if (window.rejectSave) throw new Error('Cannot save speech settings');
      window.configData = {...window.configData,...data,sherpa:{...window.configData.sherpa,...data.sherpa}};
      window.calls.push(data);
    },
    getSherpaInfo: async () => ({version:'1.13.8',status:'stopped',languages:{zh:{asr:true,tts:true},en:{asr:true,tts:false}}}),
    getLlamaCppInfo: async () => ({version:'b10809',status:'stopped',binaryPath:'/llama-server'}),
    getDefaultInstallDir: async () => '/aurapro', getInstallDir: async () => '/aurapro',
    getPackageVersion: async () => '1.13.8', listSherpaModels: async () => [],
    onMessage: () => () => {}, onData: () => () => {},
    downloadSherpaAsrModel: async () => {
      window.calls.push('download-asr');
      if (window.holdDownload) await new Promise((_, reject) => {
        window.failDownload = () => reject(new Error('Cannot download speech model'));
      });
    },
    downloadSherpaTTSModel: async () => {window.calls.push('download-tts');}
  }, {get: (object,key) => object[key] ?? (async () => undefined)});
  await initI18n();
  config.set(await window.electronAPI.getConfig());
  mount(Settings,{target:document.getElementById('app'),props:{initialTab:'speech',onClose:()=>{}}});
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
  await page.evaluate(() => {
    window.rejectSave = true
  })
  await option.click()
  await page.getByRole('alert').getByText('Cannot save speech settings').waitFor()
  assert.equal(await option.isChecked(), false)
  await page.evaluate(() => {
    window.rejectSave = false
    window.configData.sherpa.asrProfiles.ne = { model: 'newly-installed.onnx' }
  })
  await option.check()
  await page.waitForFunction(() => window.configData.sherpa.enabledLanguages.length === 3)
  assert.equal(await page.getByRole('alert').count(), 0)

  const asr = page.getByRole('button', { name: /^(下载|更新)语音识别模型$/ })
  const tts = page.getByRole('button', { name: '下载', exact: true })
  await page.evaluate(() => {
    window.holdDownload = true
  })
  await asr.click()
  await page.waitForFunction(() => window.calls.includes('download-asr'))
  assert.equal(await option.isDisabled(), true)
  assert.equal(await tts.isDisabled(), true)
  await page.evaluate(() => {
    window.holdDownload = false
    window.failDownload()
  })
  await page.getByText('Cannot download speech model').waitFor()
  await asr.click()
  await page.waitForFunction(
    () => window.calls.filter((call) => call === 'download-asr').length === 2
  )
  await tts.click()
  await page.waitForFunction(() => window.calls.includes('download-tts'))

  await option.uncheck()
  await page.waitForFunction(() => window.configData.sherpa.enabledLanguages.length === 2)
  const { sherpa, calls } = await page.evaluate(() => ({
    sherpa: window.configData.sherpa,
    calls: window.calls
  }))
  assert.deepEqual(sherpa.asrProfiles, {
    zh: { model: 'custom.onnx' },
    ne: { model: 'newly-installed.onnx' }
  })
  assert.deepEqual(sherpa.ttsProfiles, { en: { model: 'custom-voice.onnx' } })
  for (const update of calls.filter((call) => typeof call === 'object')) {
    assert.deepEqual(Object.keys(update.sherpa), ['enabledLanguages'])
  }
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
  await page.setViewportSize({ width: 1100, height: 850 })
  await page.getByRole('button', { name: '通用', exact: true }).click()
  await page.getByRole('button', { name: '切换后台运行' }).click()
  await page.waitForFunction(() => window.configData.runInBackground === false)
  await page.getByRole('button', { name: 'Open WebUI', exact: true }).click()
  await page.getByRole('button', { name: '切换启动时运行' }).click()
  await page.waitForFunction(() => window.configData.localServer.enabled === false)
  await page.getByRole('button', { name: '推理运行时', exact: true }).click()
  await page.locator('#kv-cache-type').selectOption('q4_0')
  await page.waitForFunction(() => window.configData.llamaCpp.kvCacheType === 'q4_0')
  await page.getByRole('button', { name: '启动时运行', exact: true }).click()
  await page.waitForFunction(() => window.configData.llamaCpp.enabled === true)
  assert.deepEqual(await page.evaluate(() => window.configData.llamaCpp.extraArgs), ['--no-mmap'])
  await page.getByRole('button', { name: '语音', exact: true }).click()
  await page.locator('details[open] input[type=checkbox]').first().waitFor()
  assert.equal(await page.locator('details[open] input:checked').count(), 2)
  assert.deepEqual(errors, [])
  console.log('Speech selection, ASR/TTS download, retry and desktop settings smoke checks passed')
} finally {
  await browser?.close()
  await server.close()
}

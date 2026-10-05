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
server.middlewares.use('/__glossary_test', async (_req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end(
    await server.transformIndexHtml(
      '/__glossary_test',
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module">
import { mount } from 'svelte';
import Prompt from '/src/renderer/src/lib/components/Setup/OfficialGlossaryStartup.svelte';
import { initI18n } from '/src/renderer/src/lib/i18n/index.ts';
import '/src/renderer/src/app.css';
const handlers=new Set(); window.continued=0; window.mode='error'; window.installed=false;
window.emit=(type,data)=>handlers.forEach(fn=>fn({type,data}));
window.electronAPI={
  onData:fn=>{handlers.add(fn);return ()=>handlers.delete(fn)},
  getConfig:async()=>({locale:'zh-CN'}),
  getOfficialGlossaryStartupPending:async()=>true,
  dismissOfficialGlossaryStartup:async()=>{window.continued++;window.emit('official-glossaries:startup-prompt',false);return true},
  getOfficialGlossaryStatus:async()=>({installed:window.installed,healthy:true,version:'1',fileCount:3,missingFiles:[],corruptedFiles:[]}),
  installOfficialGlossaries:async()=>{
    if(window.mode==='error')throw new Error('Invalid test access code');
    window.emit('status:official-glossaries','Downloading 50%');
    await new Promise(r=>setTimeout(r,500));
    if(window.mode==='failed')throw new Error('Download failed');
    window.installed=true;return {updated:true,version:'1'};
  },openInBrowser:async()=>{}
};initI18n();mount(Prompt,{target:document.getElementById('app')});
</script></body></html>`
    )
  )
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__glossary_test`)
  const dialog = page.locator('dialog')
  await page.locator('#official-glossary-access-code').fill('wrong')
  await page.locator('#official-glossary-access-code').press('Enter')
  await page.getByText('Invalid test access code').waitFor()
  assert.equal(await dialog.evaluate((el) => el.open), true)
  assert.equal(await page.evaluate(() => window.continued), 0)
  await page.evaluate(() => {
    window.mode = 'failed'
  })
  await page.locator('#official-glossary-access-code').press('Enter')
  await page.getByText('Downloading 50%').waitFor()
  await page.getByText('Download failed', { exact: true }).waitFor()
  assert.equal(await dialog.evaluate((el) => el.open), true)
  for (const width of [1280, 640, 360]) {
    await page.setViewportSize({ width, height: 720 })
    await fs.mkdir('.tmp-speech-ui', { recursive: true })
    await page.screenshot({ path: `.tmp-speech-ui/glossary-startup-${width}.png` })
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth))
  }
  await page.evaluate(() => {
    window.mode = 'success'
  })
  await page.locator('#official-glossary-access-code').press('Enter')
  await page.waitForFunction(() => window.continued === 1)
  assert.equal(await dialog.evaluate((el) => el.open), false)
  await page.evaluate(() => window.emit('official-glossaries:startup-prompt', true))
  await page.locator('dialog header button').click()
  await page.waitForFunction(() => window.continued === 2)
  await page.evaluate(() => window.emit('official-glossaries:startup-prompt', true))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.continued === 3)
  assert.deepEqual(errors, [])
  console.log(
    'Authorization error, download failure/progress, success, close, Escape and responsive checks passed'
  )
} finally {
  await browser?.close()
  await server.close()
}

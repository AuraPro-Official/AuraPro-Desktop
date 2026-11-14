import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createServer } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
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
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><main class="p-4"><h1>AuraPro</h1><button id="background" onclick="window.clicks++">Chat</button></main><div id="app"></div><script type="module">
import { mount } from 'svelte';
import Prompt from '/src/renderer/src/lib/components/Setup/OfficialGlossaryStartup.svelte';
import { initI18n } from '/src/renderer/src/lib/i18n/index.ts';
import '/src/renderer/src/app.css';
const handlers=new Set(); window.dismissed=0; window.clicks=0; window.mode='error'; window.installed=false;
window.emit=(type,data)=>handlers.forEach(fn=>fn({type,data}));
const initial=new URLSearchParams(location.search).get('initial');
window.electronAPI={
  onData:fn=>{handlers.add(fn);return ()=>handlers.delete(fn)},
  getOfficialGlossaryStartupPending:async()=>{
    if(initial==='error')throw new Error('State unavailable');
    if(initial==='delayed')return new Promise(resolve=>window.resolveInitial=resolve);
    return initial!=='installed';
  },
  dismissOfficialGlossaryStartup:async()=>{
    window.dismissed++;
    if(window.dismissMode==='error')throw new Error('IPC unavailable');
    if(window.dismissMode==='stalled')return new Promise(()=>{});
    window.emit('official-glossaries:startup-prompt',false);return true;
  },
  getOfficialGlossaryStatus:async()=>({installed:window.installed,healthy:true,version:'1',fileCount:3,missingFiles:[],corruptedFiles:[]}),
  installOfficialGlossaries:async()=>{
    if(window.mode==='error')throw new Error('Invalid test access code');
    window.emit('status:official-glossaries','Downloading 50%');
    if(window.mode==='deferred')await new Promise(resolve=>window.finishDownload=resolve);
    else await new Promise(r=>setTimeout(r,300));
    if(window.mode==='failed')throw new Error('Download failed');
    window.installed=true;window.emit('official-glossaries:startup-prompt',false);return {installed:true,updated:true,version:'1'};
  },openInBrowser:async()=>{}
};initI18n();mount(Prompt,{target:document.getElementById('app')});
</script></body></html>`
    )
  )
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : { channel: 'chrome' })
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const base = `http://127.0.0.1:${server.httpServer.address().port}/__glossary_test`
  const panel = page.locator('aside section')
  const input = page.locator('#official-glossary-startup-access-code')
  const visit = async (query = 'lang=zh-CN') => {
    await page.goto(`${base}?${query}`)
    await panel.waitFor()
    await page.waitForFunction(
      () => !document.querySelector('h2')?.textContent.includes('settings.')
    )
  }
  const backgroundWorks = async () => {
    const before = await page.evaluate(() => window.clicks)
    await page.locator('#background').click()
    assert.equal(await page.evaluate(() => window.clicks), before + 1)
  }
  await visit()
  assert.equal(await input.count(), 0)
  assert.equal(await page.locator('dialog').count(), 0)
  await backgroundWorks()
  await page.getByRole('button', { name: '输入授权码', exact: true }).click()
  assert.equal(await input.evaluate((el) => el === document.activeElement), true)
  await input.fill('wrong')
  await input.press('Enter')
  await page.getByText('Invalid test access code').waitFor()
  await backgroundWorks()
  assert.equal(await page.evaluate(() => window.dismissed), 0)
  await page.evaluate(() => (window.mode = 'failed'))
  await input.press('Enter')
  await page.getByText('Downloading 50%').waitFor()
  await backgroundWorks()
  await page.getByText('Download failed', { exact: true }).waitFor()
  await panel.waitFor()
  await page.evaluate(() => (window.mode = 'success'))
  await input.press('Enter')
  await panel.waitFor({ state: 'detached' })
  await page.waitForFunction(() => window.installed)
  await backgroundWorks()

  for (const mode of ['error', 'stalled']) {
    await visit()
    await page.evaluate((value) => (window.dismissMode = value), mode)
    await page.getByRole('button', { name: '稍后再说' }).click()
    await panel.waitFor({ state: 'detached' })
    await page.evaluate(() => window.emit('official-glossaries:startup-prompt', true))
    assert.equal(await panel.count(), 0, 'Dismissed reminders must not reopen in the same session')
    await backgroundWorks()
  }
  await visit()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await panel.waitFor({ state: 'detached' })
  await backgroundWorks()
  await visit()
  await page.getByRole('button', { name: '输入授权码', exact: true }).click()
  await input.press('Escape')
  await panel.waitFor({ state: 'detached' })

  await page.goto(`${base}?lang=zh-CN&initial=delayed`)
  await page.waitForFunction(() => typeof window.resolveInitial === 'function')
  await page.evaluate(() => window.emit('official-glossaries:startup-prompt', true))
  await page.getByRole('button', { name: '稍后再说' }).click()
  await page.evaluate(() => window.resolveInitial(true))
  assert.equal(await panel.count(), 0)
  await backgroundWorks()
  for (const initial of ['error', 'installed']) {
    await page.goto(`${base}?lang=zh-CN&initial=${initial}`)
    await backgroundWorks()
    assert.equal(await panel.count(), 0)
  }

  await visit()
  await page.getByRole('button', { name: '输入授权码', exact: true }).click()
  await page.evaluate(() => (window.mode = 'deferred'))
  await input.fill('test-code')
  await input.press('Enter')
  await page.getByText('Downloading 50%').waitFor()
  await page.getByRole('button', { name: '稍后再说' }).click()
  await panel.waitFor({ state: 'detached' })
  await backgroundWorks()
  await page.evaluate(() => window.finishDownload())
  await page.waitForFunction(() => window.installed)
  assert.equal(await panel.count(), 0)

  await fs.mkdir('.tmp-speech-ui', { recursive: true })
  for (const lang of ['zh-CN', 'zh-TW', 'en-US', 'es-ES']) {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 360, height: 640 },
      { width: 800, height: 480 }
    ]) {
      await page.setViewportSize(viewport)
      await visit(`lang=${lang}`)
      assert.equal((await panel.innerText()).includes('settings.glossaries.'), false)
      await backgroundWorks()
      await page.screenshot({ path: `.tmp-speech-ui/glossary-${lang}-${viewport.width}.png` })
      await page.locator('aside footer button').last().click()
      await input.waitFor()
      await input.fill('wrong')
      await input.press('Enter')
      await page.getByText('Invalid test access code').waitFor()
      assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth))
      await page.screenshot({ path: `.tmp-speech-ui/glossary-form-${lang}-${viewport.width}.png` })
      const later = page.locator('aside footer button').first()
      await later.scrollIntoViewIfNeeded()
      const box = await later.boundingBox()
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height)
      await later.click()
      await panel.waitFor({ state: 'detached' })
    }
    await page.setViewportSize({ width: 800, height: 480 })
    await visit(`lang=${lang}`)
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.screenshot({ path: `.tmp-speech-ui/glossary-${lang}-dark.png` })
    await page.locator('aside footer button').last().click()
    await input.waitFor()
    await backgroundWorks()
    await page.screenshot({ path: `.tmp-speech-ui/glossary-form-${lang}-dark.png` })
  }
  assert.deepEqual(errors, [])
  console.log(
    'Non-blocking reminders, skip/close/Escape, stalled/failed IPC, status races, background download, authorization failures and four-language responsive checks passed'
  )
} finally {
  await browser?.close()
  await server.close()
}

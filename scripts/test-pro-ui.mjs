import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
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
  runtime: 'Strata',
  platformLabel: 'Windows/Linux x64',
  status: 'stopped',
  error: '',
  logs: '',
  progress: null,
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
  if (new URLSearchParams(location.search).has('mac')) {
    info.runtime='llama.cpp'; info.platformLabel='macOS';
    info.models=${JSON.stringify(fixture.models.map((model) => ({ ...model, ramInfo: strataHardwareRecommendation(model, 'darwin') })))};
  }
  window.calls = [];
  window.electronAPI = {
    getStrataInfo: async () => structuredClone(info),
    saveStrataSettings: async (settings) => { window.calls.push(['save',settings]); info.settings=settings; },
    prepareStrataModel: async (settings) => { window.calls.push(['prepare',settings]); },
    installStrata: async () => {
      info.status='installing';
      info.progress={stage:'source',detail:'',downloadedBytes:64*1024**2,totalBytes:128*1024**2};
      await new Promise(resolve=>setTimeout(resolve,2500));
      info.progress={stage:'dependencies',detail:'Installing Pro Python dependencies'};
      await new Promise(resolve=>setTimeout(resolve,2500));
      info.progress={stage:'complete',detail:''}; info.status='stopped';
    }, checkStrataUpdate: async () => ({ version:'test-next' }),
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
server.middlewares.use('/__get_started_test', async (_req, res) => {
  const html = await server.transformIndexHtml(
    '/__get_started_test',
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="app"></main><script type="module">
    import { mount } from 'svelte';
    import Setup from '/src/renderer/src/lib/components/Main/Connections/GetStartedModal.svelte';
    import { initI18n } from '/src/renderer/src/lib/i18n/index.ts';
    import '/src/renderer/src/app.css';
    const info = ${JSON.stringify(fixture)};
    const mac = navigator.userAgent.includes('Mac');
    info.runtime = mac ? 'llama.cpp' : 'Strata';
    info.platformLabel = mac ? 'macOS' : 'Windows/Linux x64';
    if (mac) info.models.forEach(model => model.ramInfo = 'UMA 96GB');
    window.selection = null;
    window.electronAPI = {
      getConfig: async () => ({sherpa:{}}),
      getInstallDir: async () => '/test/install',
      checkInstallPreflight: async () => ({free:1024**4,pathSupported:true,writable:true,enoughSpace:true}),
      getSystemInfo: async () => ({totalMemGB:96,dedicatedVramGB:12,architecture:mac?'arm64':'x64'}),
      getStrataInfo: async () => info
    };
    initI18n();
    mount(Setup,{target:document.getElementById('app'),props:{onCancel:()=>{},onContinue:options=>{window.selection=structuredClone(options);}}});
    </script></body></html>`
  )
  res.setHeader('Content-Type', 'text/html')
  res.end(html)
})

// Execute the real installation handler with IPC doubles, including its configuration writes.
const connectionsSource = await fs.readFile(
  'src/renderer/src/lib/components/Main/Connections.svelte',
  'utf8'
)
const script = connectionsSource.split('<script lang="ts">')[1].split('</script>')[0]
const ast = ts.createSourceFile('connections.ts', script, ts.ScriptTarget.Latest, true)
const handler = ast.statements.find(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      (declaration) => declaration.name.getText(ast) === 'startInstall'
    )
)
assert.ok(handler)
const handlerJs = ts.transpileModule(handler.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText
for (const proChoice of [true, false]) {
  const calls = []
  let saved = { llamaCpp: { enabled: true }, localServer: {} }
  const api = new Proxy(
    {
      getConfig: async () => saved,
      setConfig: async (patch) => {
        saved = { ...saved, ...patch }
      },
      getInstallDir: async () => '/test/install',
      checkInstallPreflight: async () => ({
        pathSupported: true,
        writable: true,
        enoughSpace: true
      }),
      getPythonStatus: async () => false,
      getStrataInfo: async () => ({ ...fixture, installed: null }),
      getServerInfo: async () => ({ reachable: true, url: 'http://127.0.0.1:8081' }),
      getConnections: async () => [],
      startLlamaCpp: async () => ({ url: 'http://127.0.0.1:18881' }),
      startSherpa: async () => ({ url: 'http://127.0.0.1:18883' })
    },
    {
      get(target, key) {
        return async (...args) => {
          structuredClone(args)
          calls.push([key, ...args])
          return key in target ? target[key](...args) : true
        }
      }
    }
  )
  const context = {
    window: { electronAPI: api },
    console,
    Date,
    setInterval,
    clearInterval,
    setTimeout,
    navigator: { platform: 'Win32' },
    $appInfo: { platform: 'win32' },
    $i18n: { t: (key) => key },
    $state: { snapshot: structuredClone },
    sherpaInstallStatus: () => 'Starting Sherpa',
    sherpaStatus: 'stopped',
    config: { set: () => {} },
    connections: { set: () => {} },
    requiredInstallBytes: () => 0,
    connect: () => calls.push(['connect']),
    getErrorMessage: (error) => String(error),
    showToast: () => {},
    diagnoseInstallationFailure: () => ({ autoRepairable: false, technicalDetail: 'failed' }),
    lastInstallOptions: null,
    installAutoRepairAttempts: {},
    installPhase: 'idle',
    installError: '',
    installFailure: null,
    installStatus: '',
    installProgress: 0,
    proProgress: null,
    downloadItemsByKey: {},
    activeCoreDownloadKey: '',
    toastVisible: false,
    currentInstallStage: 'preflight',
    localInstalled: false,
    installAutoRepairing: false
  }
  const startInstall = vm.runInNewContext(`${handlerJs}; startInstall`, context)
  await startInstall({
    selectedModel: {
      name: 'test.gguf',
      hfRepo: 'test',
      filename: 'test.gguf',
      sizeBytes: 0,
      ...(proChoice ? { proModelId: 'qwen-iq2_xs' } : {})
    },
    installLlamaCpp: !proChoice,
    installSherpa: true,
    speechLanguages: ['zh', 'en']
  })
  assert.equal(context.installPhase, 'idle')
  assert.equal(context.localInstalled, true)
  const names = calls.map((call) => call[0])
  for (const name of ['installStrata', 'prepareStrataModel', 'startStrata'])
    assert.equal(names.includes(name), proChoice)
  for (const name of ['setupLlamaCpp', 'downloadHfModel', 'startLlamaCpp'])
    assert.equal(names.includes(name), !proChoice)
  assert.ok(names.indexOf('installPython') < names.indexOf('installPackage'))
  assert.ok(names.includes('startServer'))
  assert.equal(saved.inferenceRuntime, proChoice ? 'pro' : 'standard')
  assert.deepEqual(Array.from(saved.sherpa.enabledLanguages), ['zh', 'en'])
  await startInstall()
  assert.equal(context.installPhase, 'idle')
  if (proChoice) {
    assert.equal(saved.llamaCpp.enabled, false)
    assert.equal(calls.find((call) => call[0] === 'prepareStrataModel')[1].model, 'qwen-iq2_xs')
  }
}
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
  for (const platform of ['windows', 'linux', 'mac']) {
    const page = await browser.newPage({
      userAgent:
        platform === 'mac'
          ? 'Mozilla/5.0 (Macintosh)'
          : platform === 'windows'
            ? 'Mozilla/5.0 (Windows NT 10.0)'
            : 'Mozilla/5.0 (X11; Linux x86_64)',
      viewport: { width: 640, height: 1000 }
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${port}/__get_started_test?lang=zh-CN`)
    await page.locator('summary').filter({ hasText: '手动选择' }).click()
    {
      await page.getByText('Pro_V1 · IQ2_XS', { exact: true }).waitFor()
      assert.equal(await page.getByText(/^Pro_V1 · /).count(), 8)
      await page.getByText('Pro_V1 · IQ2_XS', { exact: true }).click()
      await page
        .getByText(`${platform === 'mac' ? 'llama.cpp' : 'Strata'} · 18882`, { exact: true })
        .waitFor()
      await page.screenshot({
        path: path.join(screenshots, `get-started-${platform}.png`),
        fullPage: true
      })
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    )
    await page.getByRole('button', { name: '继续', exact: true }).click()
    await page.waitForFunction(() => window.selection)
    const selection = await page.evaluate(() => window.selection)
    assert.equal(selection.installLlamaCpp, false)
    assert.equal(selection.selectedModel.proModelId, 'qwen-iq2_xs')
    assert.deepEqual(errors, [])
    await page.close()
  }
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
    if (proChoice) await page.getByText('Pro_V1 · IQ2_XS', { exact: true }).click()
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
  for (const [locale, width, theme] of [
    ['zh-CN', 1100],
    ['zh-CN', 640, 'dark'],
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
    if (theme === 'dark') await page.evaluate(() => document.documentElement.classList.add('dark'))
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
      await page.getByRole('button', { name: '图片输入', exact: true }).click()
      await page.getByRole('button', { name: '保存', exact: true }).click()
      assert.equal(await page.evaluate(() => window.calls[0][1].context), 16384)
      assert.equal(await page.evaluate(() => window.calls[0][1].vision), true)
      await page.getByRole('button', { name: '启动', exact: true }).click()
      await page.getByRole('button', { name: '停止', exact: true }).waitFor()
      if (!theme) {
        await page.getByRole('button', { name: '安装 / 修复', exact: true }).click()
        await page.getByText('正在下载 Pro 源码', { exact: true }).waitFor()
        await page.getByText('64.0 MB / 128.0 MB (50.0%)', { exact: true }).waitFor()
        await page.screenshot({
          path: path.join(screenshots, 'pro-install-progress.png'),
          fullPage: true
        })
        await page.getByText('正在安装 Python 依赖', { exact: true }).waitFor()
        await page
          .getByRole('button', { name: '安装 / 修复', exact: true })
          .waitFor({ state: 'visible' })
        await page.waitForFunction(() => !document.querySelector('fieldset').disabled)
      }
    }
    assert.deepEqual(errors, [])
    await page.screenshot({
      path: path.join(screenshots, `${locale}-${width}${theme ? `-${theme}` : ''}.png`),
      fullPage: true
    })
    await page.close()
  }
  {
    const page = await browser.newPage({ viewport: { width: 640, height: 1000 } })
    await page.goto(`http://127.0.0.1:${port}/__pro_test?lang=zh-CN&mac=1`)
    await page.locator('select').first().waitFor()
    assert.deepEqual(
      await page
        .locator('select')
        .first()
        .locator('option')
        .evaluateAll((options) => options.map((option) => option.value)),
      ['auto', 'metal', 'cpu']
    )
    assert.equal(await page.getByText('MTP', { exact: true }).count(), 0)
    await page.locator('select').first().selectOption('cpu')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    assert.equal(await page.evaluate(() => window.calls[0][1].backend), 'cpu')
    await page.screenshot({ path: path.join(screenshots, 'pro-macos.png'), fullPage: true })
    await page.close()
  }
  console.log('Pro UI smoke passed: four locales, narrow/desktop layouts, save and start controls.')
} finally {
  await browser?.close()
  await server.close()
}

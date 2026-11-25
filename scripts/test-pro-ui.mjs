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
  AURAPRO_ENGINE_RELEASE,
  STRATA_MODELS,
  STRATA_Q4_V31_MODEL,
  DEFAULT_STRATA_SETTINGS,
  getStrataModel,
  strataHardwareRecommendation
} from '../src/main/utils/strata-models.ts'
import {
  proGuide,
  proRequirementLabel,
  standardRequirementLabel
} from '../src/shared/model-hardware.ts'
import {
  INDEX_TRANSLATE_MODELS,
  indexTranslateCatalogEntry
} from '../src/shared/index-translate-models.ts'

const require = createRequire(import.meta.url)
const defaultModel = STRATA_MODELS.find((model) => model.id === DEFAULT_STRATA_SETTINGS.model)
const alternateModel = STRATA_MODELS.find((model) => model.id !== defaultModel.id)
const mediumQ3 = indexTranslateCatalogEntry(INDEX_TRANSLATE_MODELS.mediumQ3)
const q3Downloads = [
  [mediumQ3.hfRepo, mediumQ3.filename, mediumQ3.name, 'medium_Q3_V2'],
  [mediumQ3.mmprojRepo, mediumQ3.mmprojFilename, mediumQ3.mmprojFilename, 'medium_Q3_V2']
]
const modelDownloads = (calls) =>
  calls
    .filter(([action]) => action === 'downloadHfModel')
    .map(([, repo, filename, , , saveAs, , directory]) => [repo, filename, saveAs, directory])
const checkModelColumns = async (page, firstModel, secondModel, twoColumns = true) => {
  const list = page.locator('summary ~ div')
  const first = await list.getByText(firstModel, { exact: true }).boundingBox()
  const second = await list.getByText(secondModel, { exact: true }).boundingBox()
  assert.ok(first && second)
  assert.equal(first.y === second.y, twoColumns)
  assert.equal(second.x > first.x, twoColumns)
}
const checkWizardBadges = async (page, name, expected) => {
  const card = page.locator('summary ~ div > div').filter({
    has: page.getByText(name, { exact: true })
  })
  const labels = await card.locator('span').allTextContents()
  assert.deepEqual(
    labels
      .map((label) => label.trim())
      .filter((label) => ['图片', '视频', '音频', 'MTP'].includes(label)),
    expected
  )
}
const checkModelPreference = async (page, expectedModel) => {
  const quality = page.getByRole('button', { name: '质量', exact: true })
  const balanced = page.getByRole('button', { name: '均衡', exact: true })
  const checkRecommendation = async () => {
    if (expectedModel) {
      await page.locator('summary').getByText(expectedModel, { exact: true }).waitFor()
    }
  }
  await quality.waitFor()
  assert.equal(await quality.getAttribute('aria-pressed'), 'true')
  await checkRecommendation()
  await balanced.click()
  assert.equal(await balanced.getAttribute('aria-pressed'), 'true')
  assert.equal(await quality.getAttribute('aria-pressed'), 'false')
  await checkRecommendation()
  await quality.click()
  assert.equal(await quality.getAttribute('aria-pressed'), 'true')
}
const retiredModel = {
  ...getStrataModel('unsloth-ud-iq1_m'),
  ramInfo: 'RAM+VRAM 48G+8G',
  installed: true,
  removable: true
}
const playwrightPath =
  process.env.PLAYWRIGHT_MODULE ||
  require.resolve('playwright', {
    paths: [process.cwd(), path.join(path.dirname(process.execPath), '..', 'node_modules')]
  })
const { chromium } = require(playwrightPath)
const fixture = {
  supported: true,
  runtime: 'AuraPro-Engine',
  platformLabel: 'Windows/Linux x64',
  status: 'stopped',
  error: '',
  logs: '',
  progress: null,
  legacyModels: [],
  upgradeRequired: false,
  recommendedVersion: AURAPRO_ENGINE_RELEASE,
  installed: { version: 'test', source: 'test' },
  port: 18882,
  settings: DEFAULT_STRATA_SETTINGS,
  models: STRATA_MODELS.map((model) => ({
    ...model,
    sizeGiB: proGuide(model.name).sizeGiB,
    sizeBytes: Math.round(model.gb * 1e9),
    ramInfo: strataHardwareRecommendation(model),
    installed: true,
    experimental: false
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
  if (new URLSearchParams(location.search).has('retired')) {
    info.legacyModels=[${JSON.stringify(retiredModel)}];
    info.settings.model=info.legacyModels[0].id;
  }
  if (['fail','cancel','disk'].some(key => new URLSearchParams(location.search).has(key))) info.models.forEach(model => model.installed=false);
  if (new URLSearchParams(location.search).has('mac')) {
    info.runtime='llama.cpp'; info.platformLabel='macOS';
    info.models=${JSON.stringify(fixture.models.map((model) => ({ ...model, ramInfo: strataHardwareRecommendation(model, 'darwin') })))};
  }
  window.calls = [];
  window.electronAPI = {
    getStrataInfo: async () => structuredClone(info),
    saveStrataSettings: async (settings) => { window.calls.push(['save',settings]); info.settings=settings; },
    prepareStrataModel: async (settings) => {
      window.calls.push(['prepare',settings]); info.settings=settings;
      if (new URLSearchParams(location.search).has('disk')) {
        info.status='failed';
        info.modelDiskSpace={path:'C:/AuraPro/strata/data/models',freeBytes:22710263808,neededBytes:22853663008};
        throw new Error('Not enough disk space for the Pro model');
      }
      if (new URLSearchParams(location.search).has('fail')) throw new Error('Pro model preparation failed');
      if (new URLSearchParams(location.search).has('cancel')) {
        info.status='installing'; info.progress={stage:'model',detail:'Downloading selected model'};
        await new Promise(resolve => window.finishPrepare = resolve);
        info.status='stopped';
      }
      info.models.find(model=>model.id===settings.model).installed=true;
    },
    installStrata: async (update, settings) => {
      window.calls.push(['install', update, settings]);
      info.status='installing';
      info.progress={stage:'source',detail:'',downloadedBytes:64*1024**2,totalBytes:128*1024**2};
      await new Promise(resolve=>setTimeout(resolve,2500));
      info.progress={stage:'dependencies',detail:'Installing Pro Python dependencies'};
      await new Promise(resolve=>setTimeout(resolve,2500));
      info.progress={stage:'complete',detail:''}; info.status='stopped';
    }, checkStrataUpdate: async () => ({ version:'test-next', available:true }),
    startStrata: async () => {
      window.calls.push(['start',info.settings]);
      if (new URLSearchParams(location.search).has('rollback')) {
        info.status='starting'; info.progress={stage:'checking',detail:''};
        await new Promise(resolve => window.finishUpdate = resolve);
        info.progress={stage:'restored',detail:'New runtime did not start'};
      }
      info.status='started';
    }, stopStrata: async () => { info.status='stopped'; },
    uninstallStrata: async () => { window.calls.push(['uninstall']); info.installed=null; info.status='stopped'; info.progress=null; },
    deleteStrataModel: async (id) => {
      window.calls.push(['delete',id]);
      const active=info.models.find(model=>model.id===id);
      if (active) active.installed=false;
      else {
        info.legacyModels=info.legacyModels.filter(model=>model.id!==id);
        if (info.settings.model===id) info.settings.model=${JSON.stringify(defaultModel.id)};
      }
      info.status='stopped';
    },
    cancelStrataOperation: async () => { window.calls.push(['cancel']); window.finishPrepare?.(); }
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
    const lowRam = new URLSearchParams(location.search).has('lowRam');
    info.runtime = mac ? 'llama.cpp' : 'AuraPro-Engine';
    info.platformLabel = mac ? 'macOS' : 'Windows/Linux x64';
    window.selection = null;
    window.electronAPI = {
      getConfig: async () => ({sherpa:{}}),
      getInstallDir: async () => '/test/install',
      checkInstallPreflight: async () => ({free:1024**4,pathSupported:true,writable:true,enoughSpace:true}),
      getSystemInfo: async () => ({totalMemGB:lowRam?12:96,dedicatedVramGB:lowRam?8:12,architecture:mac?'arm64':'x64'}),
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
    selectedModel: proChoice ? { ...mediumQ3, proModelId: 'qwen-iq2_xs' } : mediumQ3,
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
  if (!proChoice) assert.deepEqual(modelDownloads(calls), q3Downloads)
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
  const lowRam = new URLSearchParams(location.search).has('lowRam');
  window.calls = [];
  window.completed = false;
  const api = {
    getInstallDir: async () => '/test/install',
    getDiskSpace: async () => ({free:1024**4}),
    checkInstallPreflight: async () => ({pathSupported:true,writable:true,enoughSpace:true}),
    getSystemInfo: async () => ({totalMemGB:lowRam?12:64,dedicatedVramGB:lowRam?8:12,architecture:'x64'}),
    getStrataInfo: async () => structuredClone(info),
    getConfig: async () => structuredClone(config),
    setConfig: async patch => {config={...config,...patch};},
    getPythonStatus: async () => true,
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
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : { channel: process.env.PRO_TEST_BROWSER || 'chrome' })
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
    const lowRam = platform === 'windows'
    await page.goto(
      `http://127.0.0.1:${port}/__get_started_test?lang=zh-CN${lowRam ? '&lowRam=1' : ''}`
    )
    await checkModelPreference(page, lowRam ? 'medium_Q4_V2.gguf' : undefined)
    await page.locator('summary').filter({ hasText: '手动选择' }).click()
    {
      await page.getByText(mediumQ3.name, { exact: true }).waitFor()
      await page.getByText(standardRequirementLabel(mediumQ3.name), { exact: false }).waitFor()
      await checkModelColumns(page, 'lowest_V2.gguf', 'low_E4.gguf')
      await checkWizardBadges(page, mediumQ3.name, ['图片', '视频'])
      await checkWizardBadges(page, 'low_E4.gguf', ['图片', '视频', '音频', 'MTP'])
      await checkWizardBadges(page, 'medium_IQ2.gguf', ['图片', '视频', 'MTP'])
      await checkWizardBadges(page, 'high_Q4.gguf', ['图片', '视频', 'MTP'])
      assert.equal(await page.getByText('Pro_V1 · Q4_K_XL', { exact: true }).count(), 0)
      const proSwitch = page.getByRole('switch', { name: 'Pro 模型' })
      await proSwitch.check()
      const suggested = platform === 'windows' ? '无' : platform === 'mac' ? 'IQ4_XS' : 'Q3_K_XL'
      const automatic = page.getByText('自动安装模型:', { exact: false })
      assert.match(await automatic.innerText(), new RegExp(`${suggested}$`))
      const continueButton = page.getByRole('button', { name: '继续', exact: true })
      assert.equal(await continueButton.isDisabled(), lowRam)
      const q4Requirement = page.getByText(proRequirementLabel('Q4_K_XL'), { exact: false })
      await q4Requirement.waitFor()
      await page.getByRole('button', { name: '均衡', exact: true }).click()
      await q4Requirement.waitFor()
      const balanced = platform === 'windows' ? '无' : platform === 'mac' ? 'Q3_K_XL' : 'Q2_K_XL'
      assert.match(await automatic.innerText(), new RegExp(`${balanced}$`))
      if (lowRam) {
        await proSwitch.uncheck()
        await page.locator('summary').getByText('medium_Q4_V2.gguf', { exact: true }).waitFor()
        await proSwitch.check()
        assert.equal(await continueButton.isDisabled(), true)
      }
      await page.getByText(`Pro_V1 · ${defaultModel.name}`, { exact: true }).waitFor()
      for (const model of STRATA_MODELS)
        await checkWizardBadges(page, `Pro_V1 · ${model.name}`, ['图片', '视频', 'MTP'])
      assert.equal(await page.getByText('Pro_V1 · Q4_K_XL', { exact: true }).count(), 1)
      assert.equal(
        await page
          .locator('summary ~ div')
          .getByText(/^Pro_V1 · /)
          .count(),
        STRATA_MODELS.length
      )
      await page.getByText(`Pro_V1 · ${defaultModel.name}`, { exact: true }).click()
      await page
        .getByText(`${platform === 'mac' ? 'llama.cpp' : 'AuraPro-Engine'} · 18882`, {
          exact: true
        })
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
    assert.equal(selection.selectedModel.proModelId, DEFAULT_STRATA_SETTINGS.model)
    assert.deepEqual(errors, [])
    await page.close()
  }
  for (const [proChoice, lowRam] of [
    [true, false],
    [false, true],
    [true, true]
  ]) {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      viewport: { width: 640, height: 1000 }
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${port}/__setup_test?lang=zh-CN${lowRam ? '&lowRam=1' : ''}`)
    await page.getByRole('button', { name: 'Download & Finish Setup' }).waitFor()
    await checkModelPreference(page, lowRam ? 'medium_Q4_V2.gguf' : undefined)
    await page.locator('summary').click()
    if (proChoice) {
      await page.getByRole('switch', { name: 'Pro 模型' }).check()
      await page.locator('summary ~ div').getByText('Pro_V1 · Q4_K_XL', { exact: true }).waitFor()
      await page.getByText(proRequirementLabel('Q4_K_XL'), { exact: false }).waitFor()
      assert.equal(
        await page
          .locator('summary ~ div')
          .getByText(/^Pro_V1 · /)
          .count(),
        STRATA_MODELS.length
      )
      assert.match(
        await page.getByText('自动安装模型:', { exact: false }).innerText(),
        lowRam ? /无$/ : /Q2_K_XL$/
      )
      const download = page.getByRole('button', { name: 'Download & Finish Setup' })
      assert.equal(await download.isDisabled(), lowRam)
      if (lowRam) {
        assert.equal(
          await page.evaluate(() =>
            window.calls.some(([action]) => action === 'prepareStrataModel')
          ),
          false
        )
        await page.getByText(`Pro_V1 · ${defaultModel.name}`, { exact: true }).click()
      }
    } else {
      await page.getByText(standardRequirementLabel(mediumQ3.name), { exact: false }).waitFor()
      await page.getByText('Recommended based on RAM/VRAM: 12G / 8G', { exact: true }).waitFor()
      await page.setViewportSize({ width: 380, height: 1000 })
      await checkModelColumns(page, 'lowest_V2', 'low_E4', false)
      await page.setViewportSize({ width: 640, height: 1000 })
    }
    await page.waitForTimeout(2200)
    if (proChoice) {
      await checkModelColumns(page, 'Pro_V1 · Q2_0', 'Pro_V1 · IQ2_XS')
      await checkWizardBadges(page, 'Pro_V1 · Q2_0', ['图片', '视频', 'MTP'])
    } else {
      await checkModelColumns(page, 'lowest_V2', 'low_E4')
      await checkWizardBadges(page, 'medium_Q3_V2', ['图片', '视频'])
      await checkWizardBadges(page, 'low_E4', ['图片', '视频', '音频', 'MTP'])
    }
    await page.screenshot({
      path: path.join(screenshots, `setup-${proChoice ? 'pro' : 'standard'}.png`),
      fullPage: true
    })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    )
    if (!proChoice) await page.getByText('medium_Q3_V2', { exact: true }).click()
    await page.getByRole('button', { name: 'Download & Finish Setup' }).click()
    await page.waitForFunction(() => window.completed)
    const calls = await page.evaluate(() => window.calls)
    const names = calls.map((call) => call[0])
    assert.equal(names.includes('installStrata'), proChoice)
    assert.equal(names.includes('prepareStrataModel'), proChoice)
    assert.equal(names.includes('startStrata'), proChoice)
    assert.equal(names.includes('startLlamaCpp'), !proChoice)
    assert.equal(names.includes('downloadHfModel'), !proChoice)
    if (!proChoice) assert.deepEqual(modelDownloads(calls), q3Downloads)
    if (proChoice) {
      assert.equal(
        calls.find(([action]) => action === 'prepareStrataModel')[1].model,
        lowRam ? DEFAULT_STRATA_SETTINGS.model : 'unsloth-ud-q2_k_xl'
      )
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
    assert.equal(await page.locator('select').count(), 4)
    assert.equal(
      await page.locator('select').first().locator('option').count(),
      STRATA_MODELS.length
    )
    assert.deepEqual(
      await page.locator('select').first().locator('option').allTextContents(),
      STRATA_MODELS.map((model) => model.name)
    )
    for (const label of new Set(STRATA_MODELS.map((model) => strataHardwareRecommendation(model))))
      assert.ok(
        await page
          .getByText(
            `~${proGuide(STRATA_MODELS.find((model) => strataHardwareRecommendation(model) === label).name).sizeGiB}G · ${label}`,
            { exact: true }
          )
          .count()
      )
    assert.equal(await page.locator('fieldset > details').getAttribute('open'), null)
    assert.equal(await page.locator('select:visible').count(), 1)
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
      const modelLabels = page
        .getByText(/~104G · RAM\+VRAM/)
        .locator('..')
        .locator('span')
      assert.deepEqual(
        (await modelLabels.allTextContents()).map((label) => label.trim()),
        ['图片', '视频', 'MTP']
      )
      const q4 = page.locator('select').first().locator(`option[value="${STRATA_Q4_V31_MODEL}"]`)
      assert.equal(await q4.textContent(), 'Q4_K_XL')
      await page.getByRole('button', { name: '启动', exact: true }).click()
      await page.getByRole('button', { name: '停止', exact: true }).waitFor()
      assert.deepEqual(await page.evaluate(() => window.calls.map((call) => call[0])), ['start'])
      await page.getByRole('button', { name: '停止', exact: true }).click()
      await page.locator('fieldset > details > summary').click()
      const deleteModel = page
        .getByText(alternateModel.name, { exact: true })
        .filter({ visible: true })
        .locator('../..')
        .getByRole('button', { name: '删除模型', exact: true })
      page.once('dialog', (dialog) => dialog.accept())
      await deleteModel.click()
      await page.waitForFunction(() => window.calls.some((call) => call[0] === 'delete'))
      assert.equal(
        await page.evaluate(() => window.calls.find((call) => call[0] === 'delete')[1]),
        alternateModel.id
      )
      const presets = page.getByRole('combobox', { name: '上下文长度', exact: true })
      for (const [label, value] of [
        ['32K', '32768'],
        ['64K', '65536'],
        ['128K', '131072'],
        ['256K', '262144']
      ]) {
        await presets.selectOption({ label })
        assert.equal(await page.locator('input[type=number]').inputValue(), value)
      }
      await page.locator('input[type=number]').fill('16384')
      assert.equal(await presets.inputValue(), 'custom')
      await page.getByRole('button', { name: '图片输入', exact: true }).click()
      await page.getByRole('button', { name: '保存', exact: true }).click()
      assert.equal(
        await page.evaluate(() => window.calls.find((call) => call[0] === 'save')[1].context),
        16384
      )
      assert.equal(
        await page.evaluate(() => window.calls.find((call) => call[0] === 'save')[1].vision),
        true
      )
      await page.locator('select').first().selectOption(alternateModel.id)
      await page.getByRole('button', { name: '启动', exact: true }).click()
      await page.getByRole('button', { name: '停止', exact: true }).waitFor()
      assert.equal(
        await page.evaluate(() => window.calls.find((call) => call[0] === 'prepare')[1].model),
        alternateModel.id
      )
      if (!theme) {
        await page.getByRole('button', { name: '安装 / 修复', exact: true }).click()
        await page.getByText('正在下载 AuraPro Engine', { exact: true }).waitFor()
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
        await page.getByRole('button', { name: '停止', exact: true }).waitFor()
        assert.deepEqual(await page.evaluate(() => window.calls.slice(-2).map((call) => call[0])), [
          'install',
          'start'
        ])
      }
    }
    assert.deepEqual(errors, [])
    await page.screenshot({
      path: path.join(screenshots, `${locale}-${width}${theme ? `-${theme}` : ''}.png`),
      fullPage: true
    })
    if (locale === 'zh-CN') {
      const uninstall = page.getByRole('button', { name: '卸载', exact: true })
      page.once('dialog', (dialog) => dialog.dismiss())
      await uninstall.click()
      assert.equal(
        await page.evaluate(() => window.calls.some((call) => call[0] === 'uninstall')),
        false
      )
      page.once('dialog', (dialog) => {
        assert.match(dialog.message(), /将删除所有 Pro 模型/)
        return dialog.accept()
      })
      await uninstall.click()
      await uninstall.waitFor({ state: 'detached' })
      assert.equal(
        await page.evaluate(() => window.calls.filter((call) => call[0] === 'uninstall').length),
        1
      )
    }
    await page.close()
  }
  {
    const page = await browser.newPage({ viewport: { width: 640, height: 1000 } })
    await page.goto(`http://127.0.0.1:${port}/__pro_test?lang=zh-CN&retired=1`)
    const models = page.locator('select').first()
    await models.locator('optgroup[label="已安装的下架模型"] option').waitFor({ state: 'attached' })
    assert.equal(await models.inputValue(), retiredModel.id)
    assert.equal(await models.locator(':scope > option').count(), STRATA_MODELS.length)
    assert.equal(await page.getByRole('button', { name: '下载 / 准备模型' }).isDisabled(), true)
    await page.getByRole('button', { name: '启动', exact: true }).click()
    await page.getByRole('button', { name: '停止', exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.calls.map(([action]) => action)), ['start'])
    await page.getByRole('button', { name: '停止', exact: true }).click()
    const row = page.getByText(retiredModel.name, { exact: true }).filter({ visible: true })
    await row.waitFor()
    page.once('dialog', (dialog) => {
      assert.match(dialog.message(), /删除后无法重新下载/)
      return dialog.accept()
    })
    await row.locator('../..').getByRole('button', { name: '删除模型' }).click()
    await models.locator('optgroup').waitFor({ state: 'detached' })
    assert.equal(await models.inputValue(), defaultModel.id)
    await page.close()
  }
  {
    const page = await browser.newPage({ viewport: { width: 640, height: 1000 } })
    await page.goto(`http://127.0.0.1:${port}/__pro_test?lang=zh-CN&mac=1`)
    await page.locator('select').first().waitFor()
    await page.locator('fieldset > details > summary').click()
    assert.deepEqual(
      await page
        .locator('select')
        .nth(1)
        .locator('option')
        .evaluateAll((options) => options.map((option) => option.value)),
      ['auto', 'metal', 'cpu']
    )
    assert.equal(await page.locator('fieldset').getByText('MTP', { exact: true }).count(), 0)
    assert.equal(
      await page.locator('span').filter({ hasText: /^MTP$/ }).count(),
      STRATA_MODELS.length
    )
    await page.locator('select').nth(1).selectOption('cpu')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    assert.equal(await page.evaluate(() => window.calls[0][1].backend), 'cpu')
    await page.screenshot({ path: path.join(screenshots, 'pro-macos.png'), fullPage: true })
    await page.close()
  }
  {
    const page = await browser.newPage({ viewport: { width: 640, height: 1000 } })
    await page.goto(`http://127.0.0.1:${port}/__pro_test?lang=zh-CN&fail=1`)
    await page.getByRole('button', { name: '启动', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Pro model preparation failed' }).waitFor()
    assert.equal(await page.evaluate(() => window.calls.some((call) => call[0] === 'start')), false)
    assert.ok(
      await page.getByRole('alert').evaluate((element) => element.getBoundingClientRect().top < 500)
    )
    await page.close()
  }
  {
    const page = await browser.newPage({ viewport: { width: 640, height: 1000 } })
    await page.goto(`http://127.0.0.1:${port}/__pro_test?lang=zh-CN&cancel=1`)
    await page.getByRole('button', { name: '启动', exact: true }).click()
    await page.waitForFunction(() => window.finishPrepare)
    await page.getByRole('button', { name: '取消准备', exact: true }).click()
    await page.waitForFunction(() => window.calls.some((call) => call[0] === 'cancel'))
    await page.getByRole('button', { name: '启动', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.calls.some((call) => call[0] === 'start')), false)
    await page.close()
  }
  {
    const page = await browser.newPage({ viewport: { width: 640, height: 1000 } })
    await page.goto(`http://127.0.0.1:${port}/__pro_test?lang=zh-CN&rollback=1`)
    await page.getByRole('button', { name: '启动', exact: true }).click()
    await page.getByText('正在检查 Pro 更新', { exact: true }).waitFor()
    await page.evaluate(() => window.finishUpdate())
    await page.getByText('更新未能启动，已恢复原运行时', { exact: true }).waitFor()
    await page.getByRole('button', { name: '停止', exact: true }).waitFor()
    await page.close()
  }
  {
    const page = await browser.newPage({ viewport: { width: 640, height: 1000 } })
    await page.goto(`http://127.0.0.1:${port}/__pro_test?lang=zh-CN&disk=1`)
    await page.getByRole('button', { name: '启动', exact: true }).click()
    const message = page.getByRole('alert')
    await message.getByText('磁盘空间不足，无法下载 Pro 模型').waitFor()
    assert.match(await message.innerText(), /22\.854 GB.*22\.710 GB.*144 MB/)
    assert.match(await message.innerText(), /C:\/AuraPro\/strata\/data\/models/)
    assert.equal(await page.evaluate(() => window.calls.some((call) => call[0] === 'start')), false)
    await page.close()
  }
  console.log('Pro UI smoke passed: four locales, narrow/desktop layouts, save and start controls.')
} finally {
  await browser?.close()
  await server.close()
}

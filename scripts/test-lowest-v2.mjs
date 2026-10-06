import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import test from 'node:test'

test('all model selection screens replace lowest with Index Translate without MTP', () => {
  for (const file of [
    'src/renderer/src/lib/components/Setup/LocalInstall.svelte',
    'src/renderer/src/lib/components/Main/Connections/GetStartedModal.svelte',
    'src/renderer/src/lib/components/Main/Settings/Models.svelte'
  ]) {
    const source = fs.readFileSync(file, 'utf8')
    const entry = source.match(/name: 'lowest_V2.gguf',[\s\S]*?ramInfo: 'RAM 8G\+'/)?.[0]
    assert.ok(entry, file)
    assert.match(entry, /IndexTeam\/Index-Translate-2B-GGUF/)
    assert.match(entry, /Index-Translate-2B.Q8_0.gguf/)
    assert.match(entry, /Index-Translate-2B.mmproj-Q8_0.gguf/)
    assert.match(entry, /sizeBytes: 2_076_674_560/)
    assert.doesNotMatch(entry, /mtpRepo|mtpFilename/)
    assert.doesNotMatch(source, /'lowest.gguf'/)
  }
})

test('runtime recognizes Index projector and never attaches a draft to lowest V2', () => {
  const source = ts.createSourceFile(
    'llamacpp.ts',
    fs.readFileSync('src/main/utils/llamacpp.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const names = [
    'getMmprojPrefixForModel',
    'getMmprojRepoForPrefix',
    'getMtpRepoForPrefix',
    'getMtpFilenameForPrefix',
    'findModelMmproj',
    'findModelDraft'
  ]
  const context = vm.createContext({
    path,
    fs: {
      existsSync: (p) => p.endsWith('Index-Translate-2B.mmproj-Q8_0.gguf'),
      statSync: () => ({ isFile: () => true })
    }
  })
  for (const name of names) {
    const statement = source.statements.find(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((decl) => decl.name.getText(source) === name)
    )
    assert.ok(statement, name)
    vm.runInContext(
      ts.transpileModule(`${statement.getText(source)}; globalThis.${name}=${name}`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
      }).outputText,
      context
    )
  }
  const prefix = context.getMmprojPrefixForModel('lowest_V2.gguf')
  assert.equal(context.getMmprojRepoForPrefix(prefix), 'IndexTeam/Index-Translate-2B-GGUF')
  assert.equal(context.getMtpRepoForPrefix(prefix), null)
  assert.equal(context.getMtpFilenameForPrefix(prefix), null)
  const mediumPrefix = context.getMmprojPrefixForModel('medium_Q4_V2.gguf')
  const highPrefix = context.getMmprojPrefixForModel('high_Q4_2.gguf')
  assert.equal(
    context.getMmprojRepoForPrefix(highPrefix),
    'IndexTeam/Index-Translate-35B-A3B-preview-GGUF'
  )
  assert.equal(context.getMtpRepoForPrefix(highPrefix), null)
  assert.equal(context.getMtpFilenameForPrefix(highPrefix), null)
  assert.equal(context.findModelDraft('/models/high_Q4_2/high_Q4_2.gguf'), null)
  assert.equal(context.getMmprojRepoForPrefix(mediumPrefix), 'IndexTeam/Index-Translate-9B-GGUF')
  assert.equal(context.getMtpRepoForPrefix(mediumPrefix), null)
  assert.equal(context.getMtpFilenameForPrefix(mediumPrefix), null)
  assert.equal(context.findModelDraft('/models/medium_Q4_V2/medium_Q4_V2.gguf'), null)
  assert.equal(context.findModelDraft('/models/lowest_V2/lowest_V2.gguf'), null)
  assert.equal(
    path.basename(context.findModelMmproj('/models/lowest_V2/lowest_V2.gguf')),
    'Index-Translate-2B.mmproj-Q8_0.gguf'
  )
})

test('medium V2 replaces automatic recommendations while keeping the old model downloadable', () => {
  for (const file of [
    'src/renderer/src/lib/components/Setup/LocalInstall.svelte',
    'src/renderer/src/lib/components/Main/Connections/GetStartedModal.svelte',
    'src/renderer/src/lib/components/Main/Settings/Models.svelte'
  ]) {
    const source = fs.readFileSync(file, 'utf8')
    const entry = source.match(
      /name: 'medium_Q4_V2.gguf',[\s\S]*?ramInfo: 'RAM\+VRAM 16G\+8G \/ UMA 10G'/
    )?.[0]
    assert.ok(entry, file)
    assert.match(entry, /IndexTeam\/Index-Translate-9B-GGUF/)
    assert.match(entry, /Index-Translate-9B.Q4_K_M.gguf/)
    assert.match(entry, /Index-Translate-9B.mmproj-Q8_0.gguf/)
    assert.match(entry, /sizeBytes: 5_780_090_304/)
    assert.doesNotMatch(entry, /mtpRepo|mtpFilename/)
    assert.match(source, /name: 'medium_Q4.gguf'/)
    if (file.endsWith('/Models.svelte')) continue
    assert.doesNotMatch(source, /modelByName\('medium_Q4.gguf'\)/)
    const script = source.split('<script lang="ts">')[1].split('</script>')[0]
    const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true)
    const context = vm.createContext({
      platform: 'win32',
      systemMemGB: 16,
      dedicatedVramGB: 8,
      modelPreference: 'speed',
      modelByName: (name) => name
    })
    for (const name of ['isAppleSiliconMac', 'qualityRecommendation', 'recommendedModel']) {
      const statement = ast.statements.find(
        (node) =>
          ts.isVariableStatement(node) &&
          node.declarationList.declarations.some((decl) => decl.name.getText(ast) === name)
      )
      assert.ok(statement, name)
      vm.runInContext(
        ts.transpileModule(`${statement.getText(ast)}; globalThis.${name}=${name}`, {
          compilerOptions: { target: ts.ScriptTarget.ES2022 }
        }).outputText,
        context
      )
    }
    assert.equal(context.recommendedModel(), 'medium_Q4_V2.gguf')
    context.systemMemGB = 32
    assert.equal(context.recommendedModel(), 'high_Q4.gguf')
    Object.assign(context, {
      platform: 'darwin',
      systemArchitecture: 'arm64',
      systemMemGB: 16,
      modelPreference: 'quality'
    })
    assert.equal(context.recommendedModel(), 'medium_Q4_V2.gguf')
  }
})

test('high Q4 2 follows high Q4 in all model lists without replacing recommendations', () => {
  for (const file of [
    'src/renderer/src/lib/components/Setup/LocalInstall.svelte',
    'src/renderer/src/lib/components/Main/Connections/GetStartedModal.svelte',
    'src/renderer/src/lib/components/Main/Settings/Models.svelte'
  ]) {
    const source = fs.readFileSync(file, 'utf8')
    const entry = source.match(
      /name: 'high_Q4_2.gguf',[\s\S]*?ramInfo: 'RAM\+VRAM 32G\+6G \/ UMA 32G'/
    )?.[0]
    assert.ok(entry, file)
    assert.match(entry, /IndexTeam\/Index-Translate-35B-A3B-preview-GGUF/)
    assert.match(entry, /Index-Translate-35B-A3B-preview.Q4_K_M.gguf/)
    assert.match(entry, /Index-Translate-35B-A3B-preview.mmproj-Q8_0.gguf/)
    assert.match(entry, /sizeBytes: 21_713_462_400/)
    const names = [...source.matchAll(/\bname: '([^']+\.gguf)'/g)].map((match) => match[1])
    assert.equal(names[names.indexOf('high_Q4.gguf') + 1], 'high_Q4_2.gguf')
    assert.doesNotMatch(source, /modelByName\('high_Q4_2.gguf'\)/)
  }
})

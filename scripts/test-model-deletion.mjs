import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const compiled = ts.transpileModule(fs.readFileSync('src/main/utils/huggingface.ts', 'utf8'), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true
  }
}).outputText

for (const shared of [false, true]) {
  test(`model deletion ${shared ? 'preserves shared' : 'removes dedicated'} attachments`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurapro-model-delete-'))
    const cache = path.join(dir, 'models')
    const folder = path.join(cache, 'high_Q4')
    const names = [
      'high_Q4.gguf',
      'mmproj-F16.gguf',
      'mtp-model.gguf',
      ...(shared ? ['other.gguf'] : [])
    ]
    fs.mkdirSync(folder, { recursive: true })
    for (const name of [...names, 'mmproj-F16.gguf.tmp', 'high_Q4.gguf.tmp'])
      fs.writeFileSync(path.join(folder, name), 'test')
    const manifest = names.map((filename) => ({
      repo: 'high_Q4',
      filename,
      filepath: path.relative(dir, path.join(folder, filename)),
      size: 4
    }))
    const unrelated = path.join(cache, 'low_E4', 'low_E4.gguf')
    fs.mkdirSync(path.dirname(unrelated), { recursive: true })
    fs.writeFileSync(unrelated, 'test')
    fs.writeFileSync(path.join(cache, 'manifest.json'), JSON.stringify(manifest))
    const exports = {}
    vm.runInNewContext(compiled, {
      exports,
      AbortController,
      require: (name) =>
        name === './index'
          ? { getInstallDir: () => dir }
          : name === 'electron-log'
            ? { info: () => undefined, warn: () => undefined, error: () => undefined }
            : require(name)
    })
    try {
      assert.equal(exports.deleteModel('high_Q4', 'high_Q4.gguf'), true)
      assert.equal(fs.existsSync(path.join(folder, 'high_Q4.gguf')), false)
      assert.equal(fs.existsSync(path.join(folder, 'high_Q4.gguf.tmp')), false)
      assert.equal(fs.existsSync(path.join(folder, 'mmproj-F16.gguf')), shared)
      assert.equal(fs.existsSync(path.join(folder, 'mtp-model.gguf')), shared)
      assert.equal(fs.existsSync(path.join(folder, 'mmproj-F16.gguf.tmp')), shared)
      assert.equal(fs.existsSync(folder), shared)
      assert.equal(fs.existsSync(unrelated), true)
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(cache, 'manifest.json'))).length,
        shared ? 3 : 0
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
}

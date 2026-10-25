import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'))
const manifest = read('package.json')
const lock = read('package-lock.json')
const compare = (actual, minimum) => {
  const a = actual.split('.').map(Number)
  const b = minimum.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

test('Electron and Vite locks enforce the reviewed security floors', () => {
  for (const [name, floor] of [
    ['electron', '43.8.3'],
    ['vite', '7.3.7']
  ]) {
    const actual = lock.packages[`node_modules/${name}`].version
    assert.ok(compare(actual, floor) >= 0, `${name}@${actual} is below ${floor}`)
    assert.equal(lock.packages[''].devDependencies[name], manifest.devDependencies[name])
  }
  assert.equal(lock.packages['node_modules/electron'].version.split('.')[0], '43')
  assert.equal(manifest.devDependencies.electron, '^43.8.3')
})

test('generic log viewer keeps xterm and removed terminal regression stays in the test chain', () => {
  assert.ok(manifest.devDependencies['@xterm/xterm'])
  assert.ok(manifest.devDependencies['@xterm/addon-fit'])
  assert.match(
    manifest.scripts['test:node'],
    /node --test scripts\/test-removed-terminal-service\.mjs/
  )
})

test('Linux release isolates targets that remove the shared sandbox', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8'
  )
  const commands = workflow
    .split(/\r?\n/)
    .filter((line) => /^\s*npx electron-builder --linux /.test(line))
  assert.ok(commands.some((line) => line.includes('--linux AppImage deb ')))
  for (const target of ['snap', 'flatpak']) {
    const command = commands.find((line) => line.includes(`--linux ${target} `))
    assert.ok(command, `${target} must be packaged independently`)
    assert.ok(!commands.some((line) => line.includes('AppImage') && line.includes(target)))
  }
})

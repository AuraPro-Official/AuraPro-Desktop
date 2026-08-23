import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isNewerLlamaBuild,
  selectLatestCompatibleLlamaRelease,
  sortLlamaBuildTagsNewestFirst
} from '../src/main/utils/llamacpp-release.ts'

const release = (tag, assets = ['cpu.zip'], options = {}) => ({
  tag_name: tag,
  assets: assets.map((name) => ({ name, browser_download_url: `https://example.test/${name}` })),
  ...options
})

test('selects the highest compatible nightly even when every nightly is a prerelease', () => {
  const selected = selectLatestCompatibleLlamaRelease(
    [
      release('v0.2.0', ['nightly-tag.txt']),
      release('b10588', ['cpu.zip'], { prerelease: true }),
      release('b10590', ['cpu.zip'], { prerelease: true }),
      release('b10589', ['cpu.zip'], { prerelease: true })
    ],
    (item) => item.assets.some((asset) => asset.name === 'cpu.zip')
  )

  assert.equal(selected?.tag_name, 'b10590')
})

test('skips drafts and releases whose platform assets are still incomplete', () => {
  const selected = selectLatestCompatibleLlamaRelease(
    [
      release('b10592', ['cpu.zip'], { draft: true, prerelease: true }),
      release('b10591', ['source.zip'], { prerelease: true }),
      release('b10590', ['cpu.zip'], { prerelease: true })
    ],
    (item) => item.assets.some((asset) => asset.name === 'cpu.zip')
  )

  assert.equal(selected?.tag_name, 'b10590')
})

test('sorts cached nightly builds numerically and keeps unknown directories last', () => {
  assert.deepEqual(sortLlamaBuildTagsNewestFirst(['runtime-cache', 'b9999', 'b10590']), [
    'b10590',
    'b9999',
    'runtime-cache'
  ])
})

test('only reports an update when the candidate build is newer', () => {
  assert.equal(isNewerLlamaBuild('b10589', 'b10590'), true)
  assert.equal(isNewerLlamaBuild('b10590', 'b10590'), false)
  assert.equal(isNewerLlamaBuild('b10591', 'b10590'), false)
})

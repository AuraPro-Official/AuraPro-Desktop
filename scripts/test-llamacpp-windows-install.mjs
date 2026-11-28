import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { close, createWriteStream, open, write } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { writeDownloadBody } from '../src/main/utils/download-stream.ts'
import {
  parseCimDisplays,
  parseDxdiagDisplays,
  summarizeDxdiagDisplays
} from '../src/main/utils/dxdiag-display.ts'
import {
  extractWindowsLlamaZip,
  LlamaArchiveBusyError,
  retryLockedArchive
} from '../src/main/utils/llamacpp-archive.ts'

const withTemp = async (cb) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aurapro-llama-test-'))
  try {
    await cb(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('the download only publishes after an actual close, including resumed writes', () =>
  withTemp(async (dir) => {
    const partial = path.join(dir, 'asset.zip.tmp')
    await writeFile(partial, 'previous ')
    let descriptorClosed = false
    const destination = createWriteStream(partial, {
      flags: 'a',
      fs: {
        open,
        write,
        close(fd, done) {
          setTimeout(
            () =>
              close(fd, (error) => {
                descriptorClosed = !error
                done(error)
              }),
            40
          )
        }
      }
    })
    const chunks = []
    await writeDownloadBody(new Response('download').body, destination, (size) => chunks.push(size))
    assert.equal(descriptorClosed, true)
    assert.deepEqual(chunks, [8])
    const archive = path.join(dir, 'asset.zip')
    await rename(partial, archive)
    assert.equal(await readFile(archive, 'utf8'), 'previous download')
  }))

test('failed writes reject and close the stream', () =>
  withTemp(async (dir) => {
    const destination = createWriteStream(dir)
    await assert.rejects(writeDownloadBody(new Response('data').body, destination, () => {}))
    assert.equal(destination.closed, true)
  }))

test('only sharing violations retry, with a bounded wait and a distinct final error', async () => {
  const inUse = Object.assign(new Error('localized error'), {
    stderr: 'details\r\nAURAPRO_ARCHIVE_SHARING_VIOLATION\r\n'
  })
  let calls = 0
  await retryLockedArchive(
    'asset.zip',
    async () => {
      if (++calls < 3) throw inUse
    },
    { waits: [0, 0] }
  )
  assert.equal(calls, 3)
  await assert.rejects(
    retryLockedArchive(
      'asset.zip',
      async () => {
        throw inUse
      },
      {
        waits: [0]
      }
    ),
    (error) => error instanceof LlamaArchiveBusyError && error.cause === inUse
  )
  let corruptCalls = 0
  await assert.rejects(
    retryLockedArchive('asset.zip', async () => {
      corruptCalls++
      throw new Error('Invalid ZIP file')
    }),
    /Invalid ZIP file/
  )
  assert.equal(corruptCalls, 1)
  const controller = new AbortController()
  await assert.rejects(
    retryLockedArchive(
      'asset.zip',
      async () => {
        throw inUse
      },
      {
        signal: controller.signal,
        onRetry: () => controller.abort()
      }
    ),
    { name: 'AbortError' }
  )
})

test('DxDiag preserves RX 5700 XT driver and dedicated memory over 4 GiB', () => {
  const displays = parseDxdiagDisplays(
    `
    Display Devices
    ---------------
       Card name: Intel(R) UHD Graphics
       Dedicated Memory: 128 MB
       Driver Version: 31.0.101.2115
       Card name: AMD Radeon RX 5700 XT
       Dedicated Memory: 8151 MB
       Shared Memory: 16334 MB
       Driver Version: 32.0.12027.1001
    ---------------
       Driver Version: 1.2.3.4
  `.replaceAll('\n', '\r\n')
  )
  assert.deepEqual(displays[1], {
    name: 'AMD Radeon RX 5700 XT',
    dedicatedMb: 8151,
    driverVersion: '32.0.12027.1001'
  })
  assert.deepEqual(summarizeDxdiagDisplays(displays), {
    gpuNames: ['Intel(R) UHD Graphics', 'AMD Radeon RX 5700 XT'],
    driverVersion: '31.0.101.2115, 32.0.12027.1001',
    totalVramMb: 8151
  })
  assert.deepEqual(
    summarizeDxdiagDisplays(
      parseDxdiagDisplays('Card name: Microsoft Basic Display Adapter\nDriver Version: 0.0.0.0')
    ),
    {
      gpuNames: ['Microsoft Basic Display Adapter'],
      driverVersion: null,
      totalVramMb: null
    }
  )
})

test('CIM fallback reads the adapter and driver without trusting its 32-bit VRAM field', () => {
  const input = {
    Name: 'AMD Radeon RX 5700 XT',
    DriverVersion: '32.0.12027.1001',
    AdapterRAM: 4294967295
  }
  const expected = { gpuNames: [input.Name], driverVersion: input.DriverVersion, totalVramMb: null }
  assert.deepEqual(summarizeDxdiagDisplays(parseCimDisplays(JSON.stringify(input))), expected)
  assert.deepEqual(summarizeDxdiagDisplays(parseCimDisplays(JSON.stringify([input]))), expected)
})

test(
  'on Windows, Expand-Archive retries a real exclusive lock without downloading again',
  {
    skip: process.platform !== 'win32',
    timeout: 60_000
  },
  () =>
    withTemp(async (dir) => {
      const content = path.join(dir, 'input')
      const archive = path.join(dir, 'archive [with spaces].zip')
      const destination = path.join(dir, 'extracted [with spaces]')
      await mkdir(content)
      await mkdir(destination)
      await writeFile(path.join(content, 'fixture.txt'), 'downloaded archive')
      const flags = ['-NoProfile', '-NonInteractive', '-Command']
      const options = {
        windowsHide: true,
        env: { ...process.env, TEST_CONTENT: content, TEST_ARCHIVE: archive }
      }
      await promisify(execFile)(
        'powershell.exe',
        [
          ...flags,
          `
      Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Archive/Microsoft.PowerShell.Archive.psd1') -ErrorAction Stop
      Compress-Archive -LiteralPath $env:TEST_CONTENT -DestinationPath $env:TEST_ARCHIVE -ErrorAction Stop
    `
        ],
        options
      )
      const holder = spawn(
        'powershell.exe',
        [
          ...flags,
          `
    $file = [IO.File]::Open($env:TEST_ARCHIVE, 'Open', 'ReadWrite', 'None')
    try { [Console]::WriteLine('LOCKED'); [Console]::ReadLine() | Out-Null } finally { $file.Dispose() }
  `
        ],
        options
      )
      const exited = once(holder, 'close')
      try {
        const ready = once(holder.stdout, 'data').then(([chunk]) => chunk.toString())
        assert.match(await Promise.race([ready, exited.then(() => '')]), /LOCKED/)
        let retries = 0
        await extractWindowsLlamaZip(archive, destination, {
          onRetry: () => {
            if (++retries === 1) holder.stdin.end('\n')
          }
        })
        assert.ok(retries > 0)
        assert.equal(
          await readFile(path.join(destination, 'input', 'fixture.txt'), 'utf8'),
          'downloaded archive'
        )
        assert.ok((await readFile(archive)).length > 0)
      } finally {
        holder.kill()
        await exited
      }
    })
)

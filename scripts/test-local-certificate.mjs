import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const older = `-----BEGIN CERTIFICATE-----
MIIBbDCCARGgAwIBAgIBATAKBggqhkjOPQQDAjAyMR4wHAYDVQQDDBVBdXJhUHJv
IExvY2FsIE5ldHdvcmsxEDAOBgNVBAoMB0F1cmFQcm8wHhcNMjYwMTAxMDAwMDAw
WhcNMjgwNDA1MDAwMDAwWjAyMR4wHAYDVQQDDBVBdXJhUHJvIExvY2FsIE5ldHdv
cmsxEDAOBgNVBAoMB0F1cmFQcm8wWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATb
pvmqO90hFXk4X/QQzOI5SB8veGf/+Jcp6msQ7q3N8G++mqRwRA1NbJ1J9VUan3DL
Vs8IaENsv+fRO60I11W5oxgwFjAUBgNVHREEDTALgglsb2NhbGhvc3QwCgYIKoZI
zj0EAwIDSQAwRgIhAM58Kns9pO1L0UnjR2g5pKlo4DYLufvMoKy+PSdXfrCdAiEA
4TUcNTY3ZnK+GWfNM5M0hxAcLIwFxqqGFDWZfaB6/lc=
-----END CERTIFICATE-----`

const current = `-----BEGIN CERTIFICATE-----
MIIBajCCARGgAwIBAgIBAjAKBggqhkjOPQQDAjAyMR4wHAYDVQQDDBVBdXJhUHJv
IExvY2FsIE5ldHdvcmsxEDAOBgNVBAoMB0F1cmFQcm8wHhcNMjYwMTAxMDAwMDAw
WhcNMjgwNDA1MDAwMDAwWjAyMR4wHAYDVQQDDBVBdXJhUHJvIExvY2FsIE5ldHdv
cmsxEDAOBgNVBAoMB0F1cmFQcm8wWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQo
42fRK0iYbp0QfMwOhs8+QMGyULQ7oJnwCtq/PIRLOwY8D/urTs3G0Tu14K8mm5VF
z9AFtW3Wq6vgtWV/VAVwoxgwFjAUBgNVHREEDTALgglsb2NhbGhvc3QwCgYIKoZI
zj0EAwIDRwAwRAIgGonIKkx6D9lFjcpG7zMg8soM1fnSGiRXPvJgE4wqGmYCIBnJ
PtnD7NR2Tr4wOxMe6PTm/XkhDPDgsmcvlvr0rDa+
-----END CERTIFICATE-----`

const fingerprint = (pem) => new X509Certificate(pem).fingerprint256.replaceAll(':', '')
const source = ts.transpileModule(
  readFileSync(new URL('../src/main/utils/local-certificate.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText

function setup(t, platform, command) {
  const root = mkdtempSync(path.join(tmpdir(), 'aura-certificate-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const exports = {}
  const modules = {
    child_process: {
      execFile: (file, args, _options, callback) => {
        try {
          callback(null, command(file, args) ?? '', '')
        } catch (error) {
          callback(error, '', '')
        }
      }
    },
    crypto: { X509Certificate },
    fs: { existsSync, mkdirSync },
    'fs/promises': fsPromises,
    os: { homedir: () => root },
    path
  }
  runInNewContext(source, {
    exports,
    require: (name) => modules[name],
    process: { platform, env: {} }
  })
  const certPath = exports.localCertificatePath(root)
  mkdirSync(path.dirname(certPath), { recursive: true })
  return { ...exports, certPath, root }
}

test('reinstalling the same certificate does not create extra records; replacement keeps old trust until install succeeds', async (t) => {
  const calls = []
  let rejectInstall = false
  const { certPath, installLocalCertificate, removeLocalCertificate } = setup(
    t,
    'win32',
    (_file, args) => {
      if (args.includes('-addstore')) {
        calls.push(['add', fingerprint(readFileSync(args.at(-1)))])
        if (rejectInstall) throw new Error('cannot install')
      } else calls.push(['delete', args.at(-1).match(/[A-F0-9]{64}/)[0]])
    }
  )
  writeFileSync(certPath, older)
  assert.equal((await installLocalCertificate(certPath)).success, true)
  assert.equal((await installLocalCertificate(certPath)).success, true)
  assert.deepEqual(calls, [
    ['add', fingerprint(older)],
    ['add', fingerprint(older)]
  ])

  writeFileSync(certPath, current)
  rejectInstall = true
  assert.equal((await installLocalCertificate(certPath)).success, false)
  assert.deepEqual(calls.at(-1), ['add', fingerprint(current)])
  rejectInstall = false
  assert.equal((await installLocalCertificate(certPath)).success, true)
  assert.deepEqual(calls.slice(-2), [
    ['add', fingerprint(current)],
    ['delete', fingerprint(older)]
  ])

  assert.equal((await removeLocalCertificate(certPath)).success, true)
  assert.deepEqual(calls.at(-1), ['delete', fingerprint(current)])
  assert.equal(readFileSync(certPath, 'utf8'), current)
})

test('NSS removal preserves a same-nickname certificate with a different fingerprint', async (t) => {
  const calls = []
  const { certPath, root, removeLocalCertificate } = setup(t, 'linux', (_file, args) => {
    calls.push(args[0])
    if (args.includes('-a')) return older
  })
  const nss = path.join(root, '.pki', 'nssdb')
  mkdirSync(nss, { recursive: true })
  writeFileSync(path.join(nss, 'cert9.db'), '')
  writeFileSync(certPath, current)
  assert.equal((await removeLocalCertificate(certPath)).success, true)
  assert.deepEqual(calls, ['-L', '-L'])
})

test('the Windows update path skips trust removal and full uninstall cleans before deleting receipts', () => {
  const script = readFileSync(new URL('../build/installer.nsh', import.meta.url), 'utf8')
  const uninstall = script.split(/!macro customUnInstall\r?\n/)[1]
  assert.match(uninstall, /\$\{ifNot\} \$\{isUpdated\}[\s\S]+?-CertDirectory /)
  assert.ok(uninstall.indexOf('-CertDirectory ') < uninstall.indexOf('RMDir /r'))
})

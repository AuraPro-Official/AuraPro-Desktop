/* eslint-disable @typescript-eslint/no-require-imports -- Electron loads this smoke-test entry as CommonJS. */
const assert = require('node:assert/strict')
const { app, BrowserWindow } = require('electron')
const pty = require('node-pty')

let window
let terminal
const timeout = setTimeout(() => {
  console.error('Electron runtime smoke timed out')
  terminal?.kill()
  app.exit(1)
}, 15000)

app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    await window.loadURL('data:text/html,<title>Runtime smoke</title><p>AuraPro</p>')
    assert.equal(await window.webContents.executeJavaScript('typeof process'), 'undefined')
    assert.equal(window.webContents.getLastWebPreferences().contextIsolation, true)
    await new Promise((resolve, reject) => {
      let output = ''
      terminal = pty.spawn(
        process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh',
        process.platform === 'win32'
          ? ['/d', '/c', 'echo aurapro-runtime-smoke']
          : ['-c', 'printf aurapro-runtime-smoke'],
        { name: 'xterm', cols: 80, rows: 24 }
      )
      terminal.onData((data) => {
        output += data
      })
      terminal.onExit(({ exitCode }) => {
        try {
          assert.equal(exitCode, 0)
          assert.match(output, /aurapro-runtime-smoke/)
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    })
    console.log(`Electron ${process.versions.electron}: isolated renderer and native PTY passed.`)
    clearTimeout(timeout)
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    clearTimeout(timeout)
    terminal?.kill()
    window?.destroy()
    app.exit(1)
  }
})

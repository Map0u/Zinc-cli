import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = mkdtempSync(join(tmpdir(), 'zinc-cwd-report-'))
const outfile = join(outDir, 'shellCwdReport.mjs')
buildSync({ entryPoints: [join(root, 'src/main/pty/shellCwdReport.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
const { createShellCwdReader } = await import(pathToFileURL(outfile).href)
test.after(() => rmSync(outDir, { recursive: true, force: true }))

test('PowerShell OSC 7 reports a changed cwd across PTY chunks', () => {
  const paths = []
  const read = createShellCwdReader((cwd) => paths.push(cwd))
  read('PS C:\\old> \u001b]7;file:///C:/Users/Example%20Person/pro')
  read('ject\u0007PS C:\\new> ')
  assert.deepEqual(paths, ['C:\\Users\\Example Person\\project'])
  read('\u001b]7;file:///D:/other\u0007')
  assert.deepEqual(paths, ['C:\\Users\\Example Person\\project', 'D:\\other'])
})

test('invalid and overlong reports do not override a valid cwd', () => {
  const paths = []
  const read = createShellCwdReader((cwd) => paths.push(cwd))
  read('\u001b]7;file:///C:/bad%zz\u0007')
  read('\u001b]7;file:///relative\u0007')
  read('\u001b]7;file:///C:/' + 'a'.repeat(5000) + '\u0007')
  assert.deepEqual(paths, [])
})

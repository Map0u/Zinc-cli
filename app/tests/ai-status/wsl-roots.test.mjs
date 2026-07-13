import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const sourceUrl = new URL('../../src/main/services/aiStatus.ts', import.meta.url)
const source = await readFile(sourceUrl, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`
const { parseWslDefaultHome, wslHomeToCodexRoot } = await import(moduleUrl)

test('accepts only the WSL default user HOME returned by the distro', () => {
  assert.equal(parseWslDefaultHome('/home/example\n'), '/home/example')
  assert.equal(parseWslDefaultHome('/home/example\r\n'), '/home/example')
  assert.equal(parseWslDefaultHome('/root'), '/root')
  const expected = ['', '', 'wsl.localhost', 'Ubuntu', 'home', 'example', '.codex'].join('\\')
  assert.equal(
    wslHomeToCodexRoot('Ubuntu', '/home/example'),
    expected
  )
})

test('rejects missing, relative, traversal, multiline, and UNC-like homes', () => {
  for (const value of ['', 'home/user', '/home/<user>/../example', '/home/example\n/home/root', '\\\\server\\home']) {
    assert.equal(parseWslDefaultHome(value), null, value)
  }
})

test('WSL discovery has no /home enumeration or username guessing fallback', () => {
  assert.match(source, /execFileSync\(\s*['"]wsl\.exe['"][\s\S]*?['"]-d['"]\s*,\s*distro[\s\S]*?['"]--['"][\s\S]*?['"]sh['"][\s\S]*?['"]-lc['"]/)
  assert.doesNotMatch(source, /safeReadDirs\(homeDir\)/)
})

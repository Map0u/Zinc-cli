const assert = require('node:assert/strict')
const test = require('node:test')
const { parseUninstallCommand, splitWindowsCommandLine } = require('../lib/uninstall-command')

test('parses a quoted absolute executable and preserves safe arguments', () => {
  assert.deepEqual(
    parseUninstallCommand('"C:\\Program Files\\Zinc\\Uninstall Zinc.exe" /currentuser /S'),
    {
      executable: 'C:\\Program Files\\Zinc\\Uninstall Zinc.exe',
      args: ['/currentuser', '/S']
    }
  )
})

test('supports CommandLineToArgvW-style quoted argument escaping', () => {
  assert.deepEqual(splitWindowsCommandLine('"C:\\Zinc\\uninstall.exe" "a b" plain'), [
    'C:\\Zinc\\uninstall.exe',
    'a b',
    'plain'
  ])
})

test('rejects shell operators, environment expansion, relative paths, and malformed quoting', () => {
  for (const command of [
    '"C:\\Zinc\\uninstall.exe" /S & calc.exe',
    '"C:\\Zinc\\uninstall.exe" /S | more',
    '%LOCALAPPDATA%\\Zinc\\uninstall.exe /S',
    '"\\\\server\\share\\uninstall.exe" /S',
    '"C:\\Zinc\\..\\uninstall.exe" /S',
    'uninstall.exe /S',
    '"C:\\Zinc\\uninstall.exe /S'
  ]) {
    assert.throws(() => parseUninstallCommand(command))
  }
})

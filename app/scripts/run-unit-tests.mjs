import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const appRoot = resolve(import.meta.dirname, '..')
const roots = [join(appRoot, 'tests')]
const files = roots.flatMap(collectTests).sort()

if (files.length === 0) {
  console.error('No runnable JavaScript unit tests were found.')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: appRoot,
  stdio: 'inherit'
})
if (result.error) throw result.error
process.exit(result.status ?? 1)

function collectTests(directory) {
  const tests = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) tests.push(...collectTests(path))
    else if (/\.test\.(?:mjs|js)$/.test(entry.name)) tests.push(path)
  }
  return tests
}

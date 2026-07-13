#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
let electronPackagePath
try {
  electronPackagePath = require.resolve('electron/package.json')
} catch {
  fail('Electron package is missing.')
}

const electronDirectory = dirname(electronPackagePath)
const pathFile = join(electronDirectory, 'path.txt')
const installScript = join(electronDirectory, 'install.js')

if (hasElectronBinary()) {
  console.log('Electron binary is ready.')
  process.exit(0)
}

if (!isFile(installScript)) {
  fail('Electron install script is missing.')
}

console.log('Electron binary is missing; running the package installer.')
const result = spawnSync(process.execPath, [installScript], {
  cwd: electronDirectory,
  env: process.env,
  stdio: 'inherit'
})

if (result.error || result.status !== 0) {
  fail('Electron package installer failed.')
}

if (!hasElectronBinary()) {
  fail('Electron package installer completed without a usable binary.')
}

console.log('Electron binary is ready.')

function hasElectronBinary() {
  if (!isFile(pathFile)) return false

  try {
    const executable = readFileSync(pathFile, 'utf8').trim()
    return executable.length > 0 && isFile(join(electronDirectory, 'dist', executable))
  } catch {
    return false
  }
}

function isFile(path) {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

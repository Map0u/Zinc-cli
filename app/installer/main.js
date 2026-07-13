const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const { execFile } = require('node:child_process')
const { existsSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { verifyPayload: verifyPayloadFiles } = require('./lib/payload-verifier')
const { parseUninstallCommand } = require('./lib/uninstall-command')
const { closeZincWithPolicy } = require('./lib/zinc-close')

const UNINSTALL_ROOTS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
]

const isDev = !app.isPackaged
let mainWindow = null
const CLI_OPERATIONS = new Set(['install', 'overwrite', 'upgrade', 'reinstall', 'downgrade', 'uninstall'])
const ZINC_EXIT_TIMEOUT_MS = 12_000
const ZINC_EXIT_POLL_INTERVAL_MS = 400
const INSTALL_STATE_TIMEOUT_MS = 15_000
const INSTALL_STATE_POLL_INTERVAL_MS = 250

function getAssetPath(...parts) {
  return isDev ? path.join(__dirname, ...parts) : path.join(process.resourcesPath, ...parts)
}

function getInstallerIconPath() {
  return isDev
    ? path.join(__dirname, '..', 'resources', 'icon.ico')
    : path.join(process.resourcesPath, 'branding', 'icon.ico')
}

function getPayloadPath() {
  return getAssetPath('payload', 'Zinc-Setup.exe')
}

function getPayloadManifestPath() {
  return getAssetPath('payload', 'payload-manifest.json')
}

function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 420,
    minWidth: 720,
    minHeight: 420,
    maxWidth: 720,
    maxHeight: 420,
    resizable: false,
    show: false,
    title: 'Zinc Installer',
    icon: getInstallerIconPath(),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: 'rgba(0,0,0,0)',
      symbolColor: '#cccccc',
      height: 48
    },
    backgroundMaterial: 'acrylic',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  return win
}

function getCliOperation() {
  for (const arg of process.argv.slice(1)) {
    if (!arg.startsWith('--')) continue
    const operation = arg.slice(2).toLowerCase()
    if (CLI_OPERATIONS.has(operation)) return operation
  }
  return null
}

function writeCliResult(result) {
  const resultPath = process.env.ZINC_INSTALLER_RESULT_FILE?.trim()
  if (!resultPath) return true
  if (!path.isAbsolute(resultPath) || /[\r\n]/.test(resultPath)) return false
  try {
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

function runFile(file, args = []) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function queryRegistry(root) {
  try {
    const { stdout } = await runFile('reg.exe', ['query', root, '/s'])
    return stdout
  } catch {
    return ''
  }
}

function parseRegistryOutput(root, output) {
  const entries = []
  let current = null

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (line.startsWith('HKEY_')) {
      if (current) entries.push(current)
      current = { root, key: line, values: {} }
      continue
    }

    if (!current) continue
    const match = line.match(/^\s{2,}([^\s].*?)\s+REG_\w+\s+(.*)$/)
    if (!match) continue
    current.values[match[1].trim()] = match[2].trim()
  }

  if (current) entries.push(current)
  return entries
}

function extractQuotedExecutable(command) {
  if (!command) return null
  const quoted = command.match(/^"([^"]+)"/)
  if (quoted) return quoted[1]
  const exe = command.match(/^([^\s]+\.exe)\b/i)
  return exe ? exe[1] : null
}

function installLocationFrom(uninstallString) {
  const exe = extractQuotedExecutable(uninstallString)
  return exe ? path.dirname(exe) : ''
}

function compareVersions(left, right) {
  const leftMatch = String(left).trim().match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/)
  const rightMatch = String(right).trim().match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/)
  if (!leftMatch || !rightMatch) return null

  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftMatch[index]) - Number(rightMatch[index])
    if (difference !== 0) return difference > 0 ? 1 : -1
  }

  const leftPrerelease = leftMatch[4] ? leftMatch[4].split('.') : []
  const rightPrerelease = rightMatch[4] ? rightMatch[4].split('.') : []
  if (!leftPrerelease.length && !rightPrerelease.length) return 0
  if (!leftPrerelease.length) return 1
  if (!rightPrerelease.length) return -1

  const length = Math.max(leftPrerelease.length, rightPrerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftPrerelease[index]
    const rightPart = rightPrerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue

    const leftNumber = /^\d+$/.test(leftPart)
    const rightNumber = /^\d+$/.test(rightPart)
    if (leftNumber && rightNumber) return Number(leftPart) > Number(rightPart) ? 1 : -1
    if (leftNumber) return -1
    if (rightNumber) return 1
    return leftPart > rightPart ? 1 : -1
  }

  return 0
}

function getRecommendedOperation(payloadVersion, installedVersion) {
  const comparison = compareVersions(payloadVersion, installedVersion)
  if (comparison === null) return { comparison: null, operation: 'reinstall' }
  if (comparison > 0) return { comparison, operation: 'upgrade' }
  if (comparison < 0) return { comparison, operation: 'downgrade' }
  return { comparison, operation: 'reinstall' }
}

async function getInstalledState() {
  const payload = verifyPayload()
  const allEntries = []
  for (const root of UNINSTALL_ROOTS) {
    allEntries.push(...parseRegistryOutput(root, await queryRegistry(root)))
  }

  const entry = allEntries.find((candidate) => {
    const name = candidate.values.DisplayName || ''
    return /^Zinc(?:\s|$)/i.test(name)
  })

  if (!entry) {
    return { installed: false, payloadReady: payload.ok, payload, exeExists: false }
  }

  const uninstallString = entry.values.UninstallString || ''
  const quietUninstallString = entry.values.QuietUninstallString || ''
  const installLocation = entry.values.InstallLocation || installLocationFrom(uninstallString)

  const exePath = installLocation ? path.join(installLocation, 'Zinc.exe') : ''
  const versionState = getRecommendedOperation(payload.version, entry.values.DisplayVersion || '')
  return {
    installed: true,
    payloadReady: payload.ok,
    payload,
    displayName: entry.values.DisplayName || 'Zinc',
    displayVersion: entry.values.DisplayVersion || '',
    versionComparison: versionState.comparison,
    recommendedOperation: versionState.operation,
    key: entry.key,
    installLocation,
    uninstallString,
    quietUninstallString,
    exePath,
    exeExists: Boolean(exePath && existsSync(exePath))
  }
}

function assertInstalledPayloadState(state) {
  if (!state.payloadReady || !state.payload?.ok) {
    throw new Error('Installer payload verification failed after the operation.')
  }
  const expectedVersion = state.payload.version
  if (!state.installed) {
    throw new Error('Zinc was not registered as installed after the operation.')
  }
  if (state.displayVersion !== expectedVersion) {
    throw new Error(`Installed Zinc version '${state.displayVersion || 'missing'}' does not match payload version '${expectedVersion}'.`)
  }
  if (!state.exeExists) {
    throw new Error('Zinc.exe was not found in the reported install location.')
  }
  return state
}

function assertUninstalledState(state) {
  if (state.installed) {
    throw new Error('Zinc is still registered as installed after uninstall.')
  }
  return state
}

async function isZincRunning() {
  try {
    const { stdout } = await runFile('tasklist.exe', ['/FI', 'IMAGENAME eq Zinc.exe', '/FO', 'CSV', '/NH'])
    return /^"Zinc\.exe",/im.test(stdout)
  } catch {
    return false
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForInstalledPayloadState() {
  const deadline = Date.now() + INSTALL_STATE_TIMEOUT_MS
  let state
  do {
    state = await getInstalledState()
    if (
      state.payloadReady &&
      state.payload?.ok &&
      state.installed &&
      state.displayVersion === state.payload.version &&
      state.exeExists
    ) {
      return state
    }
    if (Date.now() < deadline) await wait(INSTALL_STATE_POLL_INTERVAL_MS)
  } while (Date.now() < deadline)
  return assertInstalledPayloadState(state)
}

async function waitForUninstalledState() {
  const deadline = Date.now() + INSTALL_STATE_TIMEOUT_MS
  let state
  do {
    state = await getInstalledState()
    if (!state.installed) return state
    if (Date.now() < deadline) await wait(INSTALL_STATE_POLL_INTERVAL_MS)
  } while (Date.now() < deadline)
  return assertUninstalledState(state)
}

async function waitForZincExit() {
  const deadline = Date.now() + ZINC_EXIT_TIMEOUT_MS
  while (await isZincRunning()) {
    if (Date.now() >= deadline) return false
    await wait(ZINC_EXIT_POLL_INTERVAL_MS)
  }
  return true
}

async function forceCloseZincApp() {
  try {
    await runFile('taskkill.exe', ['/IM', 'Zinc.exe', '/T', '/F'])
  } catch {
    // The app is usually not running; taskkill reports that as an error.
  }
}

async function requestGracefulZincExit(state) {
  if (!state.exePath || !existsSync(state.exePath)) return
  try {
    // The installed app handles this second-instance request with app.quit(),
    // which runs its normal before-quit session persistence path.
    const args = []
    const matrixUserData = process.env.ZINC_INSTALLER_MATRIX_USER_DATA?.trim()
    if (matrixUserData && path.isAbsolute(matrixUserData) && !/[\r\n]/.test(matrixUserData)) {
      args.push(`--user-data-dir=${matrixUserData}`)
    }
    args.push('--installer-request-quit')
    await runFile(state.exePath, args)
  } catch {
    // The existing process may still have received the single-instance request.
  }
}

async function closeZincApp(state, { forceClose = false, interactive = false } = {}) {
  return closeZincWithPolicy(state, { forceClose, interactive }, {
    isRunning: isZincRunning,
    requestGracefulExit: requestGracefulZincExit,
    waitForExit: waitForZincExit,
    forceCloseProcess: forceCloseZincApp
  })
}

async function installPayload(state, closeOptions) {
  const payload = getPayloadPath()
  const verification = verifyPayload()
  if (!verification.ok) throw new Error(verification.error || 'Installer payload is invalid.')
  const closeResult = await closeZincApp(state, closeOptions)
  if (closeResult.requiresForceCloseConfirmation) return closeResult
  await runFile(payload, ['/S'])
  return { installed: true }
}

async function uninstallZinc(state, closeOptions) {
  const registeredCommand = state.quietUninstallString || state.uninstallString
  const command = parseUninstallCommand(registeredCommand)
  if (!state.quietUninstallString && !command.args.some((arg) => /^\/S$/i.test(arg))) {
    command.args.push('/S')
  }
  const closeResult = await closeZincApp(state, closeOptions)
  if (closeResult.requiresForceCloseConfirmation) return closeResult
  await runFile(command.executable, command.args)
  return { uninstalled: true }
}

function normalizeRunOptions(value) {
  return {
    forceClose: value?.forceClose === true,
    confirmDowngrade: value?.confirmDowngrade === true
  }
}

function confirmationRequired(type, operation) {
  return { confirmationRequired: type, operation }
}

async function runOperation(operation, rawOptions) {
  const state = await getInstalledState()
  const options = normalizeRunOptions(rawOptions)
  const closeOptions = {
    forceClose: options.forceClose,
    interactive: !cliOperation
  }
  if (!cliOperation && state.recommendedOperation === 'downgrade' && !options.confirmDowngrade && operation !== 'uninstall') {
    return confirmationRequired('downgrade', 'downgrade')
  }

  if (operation === 'install') {
    const result = await installPayload(state, closeOptions)
    if (result.requiresForceCloseConfirmation) return confirmationRequired('force-close', operation)
    return waitForInstalledPayloadState()
  }
  if (operation === 'overwrite' || operation === 'upgrade') {
    const result = await installPayload(state, closeOptions)
    if (result.requiresForceCloseConfirmation) return confirmationRequired('force-close', operation)
    return waitForInstalledPayloadState()
  }
  if (operation === 'reinstall' || operation === 'downgrade') {
    if (state.installed) {
      const result = await uninstallZinc(state, closeOptions)
      if (result.requiresForceCloseConfirmation) return confirmationRequired('force-close', operation)
      await waitForUninstalledState()
    }
    const result = await installPayload(state, closeOptions)
    if (result.requiresForceCloseConfirmation) return confirmationRequired('force-close', operation)
    return waitForInstalledPayloadState()
  }
  if (operation === 'uninstall') {
    if (state.installed) {
      const result = await uninstallZinc(state, closeOptions)
      if (result.requiresForceCloseConfirmation) return confirmationRequired('force-close', operation)
    }
    return waitForUninstalledState()
  }
  throw new Error(`Unknown operation: ${operation}`)
}

const cliOperation = getCliOperation()

if (!cliOperation && !app.requestSingleInstanceLock()) {
  app.quit()
}

Menu.setApplicationMenu(null)

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  if (cliOperation) {
    try {
      await runOperation(cliOperation)
      if (!writeCliResult({ ok: true, operation: cliOperation })) {
        throw new Error('Could not write the installer operation result.')
      }
      app.exit(0)
    } catch (error) {
      console.error(error.message || String(error))
      writeCliResult({ ok: false, operation: cliOperation, error: 'Installer operation failed.' })
      app.exit(1)
    }
    return
  }

  mainWindow = createWindow()
})

app.on('window-all-closed', () => app.quit())

ipcMain.handle('installer:get-state', () => getInstalledState())
ipcMain.handle('installer:run', (_event, operation, options) => runOperation(operation, options))
ipcMain.handle('app:get-locale', () => app.getLocale())
ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:close', () => mainWindow?.close())
ipcMain.handle('zinc:launch', async () => {
  const state = await getInstalledState()
  if (!state.exePath || !existsSync(state.exePath)) return false
  await shell.openPath(state.exePath)
  return true
})

function verifyPayload() {
  return verifyPayloadFiles({
    payloadPath: getPayloadPath(),
    manifestPath: getPayloadManifestPath()
  })
}

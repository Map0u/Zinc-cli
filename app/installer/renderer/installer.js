const steps = Array.from(document.querySelectorAll('.rail-item'))
const i18nNodes = Array.from(document.querySelectorAll('[data-i18n]'))
const headline = document.querySelector('#headline')
const subhead = document.querySelector('#subhead')
const locationTitle = document.querySelector('#locationTitle')
const installLocation = document.querySelector('#installLocation')
const progressBar = document.querySelector('#progressBar')
const statusLine = document.querySelector('#statusLine')
const primaryButton = document.querySelector('#primaryButton')
const backButton = document.querySelector('#backButton')
const uninstallButton = document.querySelector('#uninstallButton')
const overwriteButton = document.querySelector('#overwriteButton')
const launchButton = document.querySelector('#launchButton')
const desktopRow = document.querySelector('#desktopRow')
const payloadRow = document.querySelector('#payloadRow')
const payloadDesc = document.querySelector('#payloadDesc')
const startMenuRow = document.querySelector('#startMenuRow')
const warningRow = document.querySelector('#warningRow')
const warningTitle = document.querySelector('#warningTitle')
const warningDesc = document.querySelector('#warningDesc')
const api = window.zincInstaller || {
  getLocale: () => Promise.resolve(navigator.language),
  getState: () =>
    Promise.resolve({
      installed: false,
      payloadReady: true,
      payload: { ok: true, version: 'dev', filename: 'Zinc-Setup.exe' }
    }),
  run: () =>
    Promise.resolve({
      installed: true,
      payloadReady: true,
      payload: { ok: true, version: 'dev', filename: 'Zinc-Setup.exe' },
      displayVersion: 'dev',
      exeExists: true
    }),
  launch: () => Promise.resolve(false)
}

const dictionaries = {
  zh: {
    stepWelcome: '欢迎',
    stepInstall: '安装',
    stepFinish: '完成',
    installTitle: '安装 Zinc',
    installSubhead: '为当前用户安装 Zinc 终端。',
    readyStepTitle: '准备安装',
    readyStepSubhead: 'Zinc 将安装到固定的当前用户应用目录，不能在此安装器中更改。',
    installedTitle: 'Zinc 已安装',
    installedSubhead: '可以覆盖安装、重新安装，或从当前用户中移除。',
    reinstallingTitle: '重新安装 Zinc',
    overwritingTitle: '覆盖安装 Zinc',
    upgradingTitle: '升级 Zinc',
    downgradingTitle: '降级 Zinc',
    installingTitle: '正在安装 Zinc',
    uninstallingTitle: '正在卸载 Zinc',
    readyTitle: 'Zinc 已就绪',
    removedTitle: 'Zinc 已卸载',
    locationTitle: '安装位置（固定）',
    installedLocationTitle: '当前位置',
    desktopTitle: '桌面快捷方式',
    desktopDesc: '安装后在桌面创建 Zinc 快捷方式。',
    payloadTitle: '载荷版本',
    payloadReady: '将安装 Zinc {version}。',
    payloadInvalid: '安装包载荷校验失败。',
    startMenuTitle: '开始菜单',
    startMenuDesc: '安装后添加到开始菜单。',
    enabled: '已启用',
    install: '安装',
    next: '下一步',
    back: '返回',
    upgrade: '升级',
    downgrade: '降级',
    overwrite: '覆盖安装',
    reinstall: '重新安装',
    uninstall: '卸载',
    launch: '启动 Zinc',
    checking: '正在检查安装状态...',
    ready: '准备就绪。',
    confirmInstall: '点击安装后会写入程序文件。',
    downgradeWarningTitle: '版本降级警告',
    downgradeWarning: '安装包版本低于当前已安装版本。降级可能不兼容较新的设置或会话数据。',
    confirmDowngrade: '此安装包版本低于当前已安装版本。继续降级可能影响设置或会话数据。是否继续？',
    forceCloseWarning: 'Zinc 仍在运行，强制关闭将终止其中正在运行的任务。是否强制关闭并继续？',
    confirmUninstall: '确定要卸载 Zinc 吗？应用会被移除，但设置与会话数据会保留。',
    missingPayload: '安装包载荷缺失。',
    installed: '已安装。',
    installing: '正在写入程序文件...',
    overwriting: '正在覆盖当前安装...',
    upgrading: '正在升级当前安装...',
    reinstalling: '正在替换当前安装...',
    uninstalling: '正在移除程序文件...',
    done: '完成。',
    removed: '应用已卸载，设置与会话数据保留在 %APPDATA%\\zinc，可手动删除。',
    currentUser: '当前用户配置目录',
    failedState: '无法读取安装状态。',
    failedOperation: '操作未完成。',
    verificationFailed: '安装结果验证失败。'
  },
  en: {
    stepWelcome: 'Welcome',
    stepInstall: 'Install',
    stepFinish: 'Finish',
    installTitle: 'Install Zinc',
    installSubhead: 'Install Zinc terminal for the current user.',
    readyStepTitle: 'Ready to install',
    readyStepSubhead: 'Zinc installs to the fixed current-user app directory; this installer cannot change it.',
    installedTitle: 'Zinc is installed',
    installedSubhead: 'Overwrite, reinstall, or remove it from the current user.',
    reinstallingTitle: 'Reinstall Zinc',
    overwritingTitle: 'Overwrite Zinc',
    upgradingTitle: 'Upgrade Zinc',
    downgradingTitle: 'Downgrade Zinc',
    installingTitle: 'Installing Zinc',
    uninstallingTitle: 'Uninstalling Zinc',
    readyTitle: 'Zinc is ready',
    removedTitle: 'Zinc was uninstalled',
    locationTitle: 'Install location (fixed)',
    installedLocationTitle: 'Current location',
    desktopTitle: 'Desktop shortcut',
    desktopDesc: 'Create a Zinc shortcut on the desktop.',
    payloadTitle: 'Payload version',
    payloadReady: 'Will install Zinc {version}.',
    payloadInvalid: 'Installer payload verification failed.',
    startMenuTitle: 'Start menu',
    startMenuDesc: 'Add Zinc to the Start menu.',
    enabled: 'Enabled',
    install: 'Install',
    next: 'Next',
    back: 'Back',
    upgrade: 'Upgrade',
    downgrade: 'Downgrade',
    overwrite: 'Overwrite',
    reinstall: 'Reinstall',
    uninstall: 'Uninstall',
    launch: 'Launch Zinc',
    checking: 'Checking installed state...',
    ready: 'Ready.',
    confirmInstall: 'Click Install to write application files.',
    downgradeWarningTitle: 'Downgrade warning',
    downgradeWarning: 'This installer is older than the installed version. A downgrade may be incompatible with newer settings or session data.',
    confirmDowngrade: 'This installer is older than the installed version. Continuing may affect settings or session data. Do you want to continue?',
    forceCloseWarning: 'Zinc is still running. Force closing it will terminate tasks running inside it. Force close and continue?',
    confirmUninstall: 'Uninstall Zinc? The app will be removed, but settings and session data will be kept.',
    missingPayload: 'Installer payload is missing.',
    installed: 'Installed.',
    installing: 'Writing application files...',
    overwriting: 'Overwriting the current installation...',
    upgrading: 'Upgrading the current installation...',
    reinstalling: 'Replacing the current installation...',
    uninstalling: 'Removing application files...',
    done: 'Done.',
    removed: 'The app was uninstalled. Settings and session data remain in %APPDATA%\\zinc and can be deleted manually.',
    currentUser: 'Current user profile',
    failedState: 'Could not read installed state.',
    failedOperation: 'The operation did not complete.',
    verificationFailed: 'The installation result could not be verified.'
  }
}

let lang = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
let t = dictionaries[lang]
let state = { installed: false, payloadReady: false }
let busy = false
let wizardStep = 'welcome'
const wizardOrder = ['welcome', 'install']

function applyLanguage(nextLang) {
  lang = nextLang
  t = dictionaries[lang]
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  for (const node of i18nNodes) {
    node.textContent = t[node.dataset.i18n]
  }
  launchButton.textContent = t.launch
  backButton.textContent = t.back
  uninstallButton.textContent = t.uninstall
  overwriteButton.textContent = t.overwrite
}

function setStep(active) {
  const order = ['welcome', 'install', 'finish']
  const activeIndex = order.indexOf(active)
  for (const step of steps) {
    const index = order.indexOf(step.dataset.step)
    const canNavigate = state.installed ? order.includes(step.dataset.step) : wizardOrder.includes(step.dataset.step)
    step.classList.toggle('is-active', index === activeIndex)
    step.classList.toggle('is-complete', index < activeIndex)
    step.classList.toggle('is-navigable', canNavigate)
    step.tabIndex = canNavigate ? 0 : -1
    step.setAttribute('role', 'button')
    step.setAttribute('aria-disabled', canNavigate ? 'false' : 'true')
  }
}

function setProgress(value) {
  progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`
}

function setBusy(nextBusy) {
  busy = nextBusy
  document.body.classList.toggle('is-busy', busy)
  primaryButton.disabled = busy || (primaryButton.dataset.action !== 'next' && !state.payloadReady)
  backButton.disabled = busy
  uninstallButton.disabled = busy
  overwriteButton.disabled = busy || !state.payloadReady
  launchButton.disabled = busy
  for (const step of steps) {
    step.classList.toggle('is-disabled', busy)
  }
}

function setWarning(title = '', description = '') {
  const visible = Boolean(title || description)
  warningRow.hidden = !visible
  warningTitle.textContent = title
  warningDesc.textContent = description
}

function setRowsVisible(visible) {
  desktopRow.hidden = !visible
  payloadRow.hidden = !visible
  startMenuRow.hidden = !visible
}

function updatePayloadRow() {
  const payload = state.payload || {}
  if (state.payloadReady && payload.version) {
    payloadDesc.textContent = t.payloadReady.replace('{version}', payload.version)
  } else if (payload.error) {
    payloadDesc.textContent = payload.error
  } else {
    payloadDesc.textContent = t.payloadInvalid
  }
}

function renderWizard(step = wizardStep) {
  wizardStep = step
  const location = state.installLocation || t.currentUser
  const payloadReady = Boolean(state.payloadReady)

  setStep(wizardStep)
  installLocation.textContent = location
  locationTitle.textContent = t.locationTitle
  updatePayloadRow()
  uninstallButton.hidden = true
  overwriteButton.hidden = true
  launchButton.hidden = true
  backButton.hidden = wizardStep === 'welcome'
  setWarning()

  if (wizardStep === 'welcome') {
    headline.textContent = t.installTitle
    subhead.textContent = t.installSubhead
    statusLine.textContent = payloadReady ? t.ready : t.missingPayload
    primaryButton.hidden = false
    primaryButton.textContent = t.next
    primaryButton.dataset.action = 'next'
    setRowsVisible(false)
    setProgress(0)
  } else {
    headline.textContent = t.readyStepTitle
    subhead.textContent = t.readyStepSubhead
    statusLine.textContent = payloadReady ? t.confirmInstall : t.missingPayload
    primaryButton.hidden = false
    primaryButton.textContent = t.install
    primaryButton.dataset.action = 'install'
    setRowsVisible(true)
    setProgress(50)
  }

  setBusy(false)
}

function render(nextState = state) {
  state = nextState
  const installed = Boolean(state.installed)
  const location = state.installLocation || t.currentUser

  installLocation.textContent = location
  updatePayloadRow()

  if (installed) {
    renderInstalledStep('finish')
    return
  } else {
    renderWizard('welcome')
    return
  }

  setBusy(false)
}

function goToStep(step) {
  if (busy) return
  if (state.installed) {
    renderInstalledStep(step)
    return
  }
  if (wizardOrder.includes(step)) renderWizard(step)
}

function renderInstalledStep(step = 'finish') {
  const order = ['welcome', 'install', 'finish']
  const activeStep = order.includes(step) ? step : 'finish'
  const versionComparison = state.versionComparison
  const recommendedOperation = state.recommendedOperation
  const canUpgrade = recommendedOperation === 'upgrade' || versionComparison > 0
  const isDowngrade = recommendedOperation === 'downgrade' || versionComparison < 0
  wizardStep = activeStep
  installLocation.textContent = state.installLocation || t.currentUser
  updatePayloadRow()
  locationTitle.textContent = t.installedLocationTitle
  primaryButton.textContent = canUpgrade ? t.upgrade : isDowngrade ? t.downgrade : t.reinstall
  primaryButton.dataset.action = canUpgrade ? 'upgrade' : isDowngrade ? 'downgrade' : 'reinstall'
  primaryButton.hidden = false
  backButton.hidden = true
  overwriteButton.textContent = t.overwrite
  overwriteButton.dataset.action = 'overwrite'
  overwriteButton.hidden = false
  uninstallButton.hidden = false
  launchButton.hidden = false

  if (activeStep === 'install') {
    headline.textContent = canUpgrade ? t.upgradingTitle : isDowngrade ? t.downgradingTitle : t.reinstallingTitle
    subhead.textContent = t.installedSubhead
    statusLine.textContent = isDowngrade ? t.downgradeWarning : t.confirmInstall
    setRowsVisible(false)
    setProgress(50)
  } else if (activeStep === 'finish') {
    headline.textContent = t.installedTitle
    subhead.textContent = t.installedSubhead
    statusLine.textContent = state.displayName || t.installed
    setRowsVisible(false)
    setProgress(100)
  } else {
    headline.textContent = t.installedTitle
    subhead.textContent = t.installedSubhead
    statusLine.textContent = state.displayName || t.installed
    setRowsVisible(false)
    setProgress(0)
  }

  setWarning(isDowngrade ? `⚠ ${t.downgradeWarningTitle}` : '', isDowngrade ? t.downgradeWarning : '')

  setStep(activeStep)
  setBusy(false)
}

async function refresh() {
  setBusy(true)
  statusLine.textContent = t.checking
  try {
    const locale = await api.getLocale()
    applyLanguage(locale.toLowerCase().startsWith('zh') ? 'zh' : 'en')
    render(await api.getState())
  } catch (error) {
    statusLine.textContent = error.message || t.failedState
    setBusy(false)
  }
}

async function runOperation(operation, options = {}) {
  if (busy) return
  setBusy(true)
  setStep('install')
  setRowsVisible(false)
  setWarning()
  setProgress(operation === 'uninstall' ? 34 : 28)
  locationTitle.textContent = state.installed ? t.installedLocationTitle : t.locationTitle

  if (operation === 'uninstall') {
    headline.textContent = t.uninstallingTitle
    subhead.textContent = t.uninstalling
    statusLine.textContent = t.uninstalling
  } else if (operation === 'overwrite') {
    headline.textContent = t.overwritingTitle
    subhead.textContent = t.overwriting
    statusLine.textContent = t.overwriting
  } else if (operation === 'upgrade') {
    headline.textContent = t.upgradingTitle
    subhead.textContent = t.upgrading
    statusLine.textContent = t.upgrading
  } else if (operation === 'downgrade') {
    headline.textContent = t.downgradingTitle
    subhead.textContent = t.downgradeWarning
    statusLine.textContent = t.downgradingTitle
  } else if (operation === 'reinstall') {
    headline.textContent = t.reinstallingTitle
    subhead.textContent = t.reinstalling
    statusLine.textContent = t.reinstalling
  } else {
    headline.textContent = t.installingTitle
    subhead.textContent = t.installing
    statusLine.textContent = t.installing
  }

  try {
    const nextState = await api.run(operation, options)
    if (nextState?.confirmationRequired) {
      await handleConfirmation(nextState, options)
      return
    }
    if (!operationStateIsVerified(operation, nextState)) {
      throw new Error(t.verificationFailed)
    }
    setProgress(100)
    setStep('finish')
    primaryButton.hidden = false
    state = nextState
    headline.textContent = operation === 'uninstall' ? t.removedTitle : t.readyTitle
    subhead.textContent = operation === 'uninstall' ? t.removed : t.done
    statusLine.textContent = t.done
    window.setTimeout(() => render(nextState), 500)
  } catch (error) {
    try {
      // A reinstall/downgrade can fail after the old version was already
      // removed. Re-read the registry-backed state instead of rendering the
      // operation's stale preflight snapshot.
      state = await api.getState()
      render(state)
    } catch {
      // Keep the last known state when the refresh itself is unavailable; the
      // original operation error remains the useful message for the user.
    }
    setStep(state.installed ? 'finish' : 'welcome')
    setProgress(state.installed ? 100 : 0)
    statusLine.textContent = error.message || t.failedOperation
    setBusy(false)
  }
}

async function handleConfirmation(result, options) {
  setBusy(false)
  if (result.confirmationRequired === 'downgrade') {
    if (window.confirm(t.confirmDowngrade)) {
      await runOperation(result.operation, { ...options, confirmDowngrade: true })
      return
    }
  } else if (result.confirmationRequired === 'force-close') {
    if (window.confirm(t.forceCloseWarning)) {
      await runOperation(result.operation, { ...options, forceClose: true })
      return
    }
  } else {
    throw new Error(t.failedOperation)
  }

  render(state)
}

for (const step of steps) {
  step.addEventListener('click', () => goToStep(step.dataset.step))
  step.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    goToStep(step.dataset.step)
  })
}

primaryButton.addEventListener('click', () => {
  const operation = primaryButton.dataset.action || 'install'
  if (operation === 'next') {
    renderWizard('install')
    return
  }
  runOperation(operation)
})
backButton.addEventListener('click', () => renderWizard('welcome'))
uninstallButton.addEventListener('click', () => {
  if (!window.confirm(t.confirmUninstall)) return
  runOperation('uninstall')
})
overwriteButton.addEventListener('click', () => runOperation(overwriteButton.dataset.action || 'overwrite'))
launchButton.addEventListener('click', async () => {
  await api.launch()
})

applyLanguage(lang)
refresh()

function operationStateIsVerified(operation, nextState) {
  if (operation === 'uninstall') return !nextState?.installed
  const payloadVersion = nextState?.payload?.version || ''
  return Boolean(
    nextState?.installed &&
      nextState?.payloadReady &&
      nextState?.payload?.ok &&
      payloadVersion &&
      nextState?.displayVersion === payloadVersion &&
      nextState?.exeExists
  )
}

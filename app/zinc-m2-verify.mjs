import { chromium } from 'playwright-core'
import { assert, createTestTab, runSmoke, waitFor } from './tests/cdp/smoke-helpers.mjs'

const CDP_ENDPOINT = process.env.ZINC_CDP_ENDPOINT || 'http://127.0.0.1:9336'
const DEFAULT_TIMEOUT_MS = 15_000

await runSmoke('m2 tab lifecycle', async ({ page }) => {
  const sourceId = await createTestTabAtCwd(page, 'C:\\Windows\\Temp')
  const otherId = await createTestTab(page)
  const nonce = Date.now().toString(36)

  const sourceRow = page.locator(`[data-tabid="${sourceId}"]`)
  await sourceRow.click()
  await waitFor(
    page,
    (id) => {
      const entry = window.__zincRegistry.hosts?.get(id)
      return window.__zincTabs.activeId === id && entry?.state === 'ready' && document.activeElement === entry.term.textarea
    },
    sourceId,
    'switching back to a test tab did not restore terminal focus'
  )

  const switchMarker = `ZINC-SWITCH-${nonce}`
  await page.keyboard.insertText(`Write-Output ('ZINC-SWITCH-' + '${nonce}')`)
  await page.keyboard.press('Enter')
  await waitFor(
    page,
    ({ id, marker }) => window.__zincRegistry.getBufferText(id).includes(marker),
    { id: sourceId, marker: switchMarker },
    'typed input did not reach the switched test tab'
  )
  const otherBuffer = await page.evaluate((id) => window.__zincRegistry.getBufferText(id), otherId)
  assert(!otherBuffer.includes(switchMarker), 'typed input after switching does not leak into another test tab')

  const rename = `Zinc smoke ${nonce}`
  await sourceRow.click({ button: 'right' })
  await waitForContextMenu(page, 'rename context menu did not open')
  // Rename is an inline input in the tab row: Electron never implemented
  // window.prompt (it throws), so a dialog-driven rename cannot exist here.
  await page.locator('[role="menu"] [role="menuitem"]').nth(0).click()
  const renameInput = sourceRow.locator('input')
  await renameInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS })
  await renameInput.fill(rename)
  await renameInput.press('Enter')
  await waitFor(
    page,
    ({ id, expected }) => window.__zincTabs.tabs.some((tab) => tab.id === id && tab.customTitle === expected),
    { id: sourceId, expected: rename },
    'tab rename did not update the tab model'
  )
  assert(
    (await sourceRow.locator('span[title]').getAttribute('title')) === rename,
    'renamed test tab exposes the new title in the rail'
  )

  const idsBeforeDuplicate = await page.evaluate(() => window.__zincTabs.tabs.map((tab) => tab.id))
  await sourceRow.click({ button: 'right' })
  await waitForContextMenu(page, 'duplicate context menu did not open')
  await page.locator('[role="menu"] [role="menuitem"]').nth(1).click()
  await waitFor(
    page,
    (existingIds) => window.__zincTabs.tabs.some((tab) => !existingIds.includes(tab.id)),
    idsBeforeDuplicate,
    'duplicate test tab was not created'
  )

  const duplicate = await page.evaluate((existingIds) =>
    window.__zincTabs.tabs.find((tab) => !existingIds.includes(tab.id)), idsBeforeDuplicate)
  assert(duplicate && duplicate.id !== sourceId, 'duplicate receives a distinct tab id')
  assert(duplicate.customTitle === rename, 'duplicate preserves the custom title')
  const duplicateId = duplicate.id
  await waitForReadyHost(page, duplicateId, 'duplicated test terminal did not become ready')

  const [sourceCwd, duplicateCwd] = await page.evaluate(async ({ source, clone }) =>
    Promise.all([window.zinc.pty.getCwd(source), window.zinc.pty.getCwd(clone)]),
  { source: sourceId, clone: duplicateId })
  assert(sourceCwd, 'source test tab exposes its process working directory')
  assert(duplicateCwd, 'duplicated test tab exposes its process working directory')
  assert(
    normalizeWindowsPath(sourceCwd) === normalizeWindowsPath(duplicateCwd),
    'duplicate inherits the source test tab working directory',
    `${sourceCwd} != ${duplicateCwd}`
  )

  const ids = await page.evaluate(() => window.__zincTabs.tabs.map((tab) => tab.id))
  assert(new Set(ids).size === ids.length, 'all tab ids remain unique across create and duplicate')

  const otherRow = page.locator(`[data-tabid="${otherId}"]`)
  await otherRow.click({ button: 'middle' })
  await waitFor(
    page,
    (id) => !window.__zincTabs.tabs.some((tab) => tab.id === id),
    otherId,
    'middle-click did not close the non-active test tab'
  )
  assert(
    (await page.evaluate(() => window.__zincTabs.activeId)) === duplicateId,
    'closing a non-active test tab preserves the active duplicate'
  )

  const duplicateRow = page.locator(`[data-tabid="${duplicateId}"]`)
  await duplicateRow.locator('button').click()
  await waitFor(
    page,
    ({ closedId, expectedActiveId }) =>
      !window.__zincTabs.tabs.some((tab) => tab.id === closedId) && window.__zincTabs.activeId === expectedActiveId,
    { closedId: duplicateId, expectedActiveId: sourceId },
    'closing the active test tab did not activate the last remaining test tab'
  )
  await waitFor(
    page,
    (id) => {
      const entry = window.__zincRegistry.hosts?.get(id)
      return entry?.state === 'ready' && document.activeElement === entry.term.textarea
    },
    sourceId,
    'terminal focus did not recover after closing the active test tab'
  )
  assert(await sourceRow.isVisible(), 'source test tab remains available after lifecycle checks')
})

if (!process.exitCode && process.env.ZINC_TEST_ISOLATED === '1') {
  await verifyIsolatedLastTabQuit()
} else if (!process.exitCode) {
  console.log('skip: last-tab quit verification requires ZINC_TEST_ISOLATED=1')
}

async function createTestTabAtCwd(page, cwd) {
  const before = await page.evaluate(() => window.__zincTabs.tabs.map((tab) => tab.id))
  await page.evaluate((spawnCwd) => window.__zincTabs.addTab(spawnCwd), cwd)
  await waitFor(
    page,
    (existingIds) => Boolean(window.__zincTabs.activeId && !existingIds.includes(window.__zincTabs.activeId)),
    before,
    'test tab with explicit working directory was not created'
  )
  const id = await page.evaluate(() => window.__zincTabs.activeId)
  assert(id, 'test tab with explicit working directory has an active id')
  await waitForReadyHost(page, id, 'test terminal with explicit working directory did not become ready')
  return id
}

async function waitForReadyHost(page, id, message) {
  await waitFor(
    page,
    (tabId) => {
      const entry = window.__zincRegistry.hosts?.get(tabId)
      return Boolean(entry && entry.state === 'ready' && entry.term.cols > 1 && entry.term.rows > 0)
    },
    id,
    message
  )
}

async function waitForContextMenu(page, message) {
  await waitFor(
    page,
    () => document.querySelectorAll('[role="menu"] [role="menuitem"]').length === 2,
    undefined,
    message
  )
}

function normalizeWindowsPath(value) {
  return value.replaceAll('/', '\\').replace(/[\\/]+$/, '').toLowerCase()
}

async function verifyIsolatedLastTabQuit() {
  let browser
  try {
    browser = await chromium.connectOverCDP(CDP_ENDPOINT, { timeout: DEFAULT_TIMEOUT_MS })
    const context = browser.contexts()[0]
    assert(context, 'reconnected to the isolated Zinc CDP context for last-tab verification')
    const page = context.pages()[0] || (await context.waitForEvent('page', { timeout: DEFAULT_TIMEOUT_MS }))
    await waitFor(
      page,
      () => Boolean(window.__zincTabs && window.__zincTabs.tabs.length > 0),
      undefined,
      'isolated Zinc tab model did not become ready for last-tab verification'
    )

    const state = await page.evaluate(() => ({
      ids: window.__zincTabs.tabs.map((tab) => tab.id),
      activeId: window.__zincTabs.activeId
    }))
    assert(state.ids.length === 1, 'isolated last-tab verification starts with exactly one disposable tab')
    assert(state.activeId === state.ids[0], 'the isolated disposable tab is active before quit')

    const closePromise = page.waitForEvent('close', { timeout: DEFAULT_TIMEOUT_MS })
    try {
      await page.evaluate((id) => window.__zincTabs.closeTab(id), state.ids[0])
    } catch (error) {
      if (!page.isClosed()) throw error
    }
    await closePromise
    assert(page.isClosed(), 'closing the isolated last tab exits Zinc through the unified quit path')
    console.log('\nPASS: m2 isolated last-tab quit')
  } finally {
    if (browser?.isConnected()) await browser.close()
  }
}

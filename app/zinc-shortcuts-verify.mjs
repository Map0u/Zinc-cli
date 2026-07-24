/**
 * CDP journey: default daily keyboard shortcuts → observable app effects.
 * Drives the shipped ShortcutManager path (keydown capture / main fallback).
 */
import {
  assert,
  createTestTab,
  runSmoke,
  waitFor
} from './tests/cdp/smoke-helpers.mjs'

await runSmoke('daily default shortcuts', async ({ page, baseline }) => {
  await waitFor(
    page,
    () => Boolean(window.__zincTabs && window.__zincTabs.tabs.length > 0),
    undefined,
    'tabs not ready for shortcut exercises'
  )

  const startTabCount = await page.evaluate(() => window.__zincTabs.tabs.length)
  const startActiveId = await page.evaluate(() => window.__zincTabs.activeId)
  // zoomIn/Out/reset ship as terminal FontSize bumps (not Electron UiZoom).
  const startFontSize = await page.evaluate(async () => {
    const settings = await window.zinc.settings.get()
    return settings.FontSize
  })

  // newTab — Ctrl+Shift+T
  await page.keyboard.down('Control')
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyT')
  await page.keyboard.up('Shift')
  await page.keyboard.up('Control')
  await waitFor(
    page,
    (count) => window.__zincTabs.tabs.length === count + 1,
    startTabCount,
    'Ctrl+Shift+T did not open a new tab'
  )
  const afterNewId = await page.evaluate(() => window.__zincTabs.activeId)
  assert(afterNewId && afterNewId !== startActiveId, 'new tab is active after Ctrl+Shift+T')

  // nextTab / prevTab — Ctrl+Tab / Ctrl+Shift+Tab
  const beforeNext = await page.evaluate(() => window.__zincTabs.activeId)
  await page.keyboard.down('Control')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Control')
  await waitFor(
    page,
    (prev) => window.__zincTabs.activeId !== prev,
    beforeNext,
    'Ctrl+Tab did not switch tab'
  )
  const afterNext = await page.evaluate(() => window.__zincTabs.activeId)

  await page.keyboard.down('Control')
  await page.keyboard.down('Shift')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Shift')
  await page.keyboard.up('Control')
  await waitFor(
    page,
    (expected) => window.__zincTabs.activeId === expected,
    beforeNext,
    'Ctrl+Shift+Tab did not return to previous tab'
  )
  assert(afterNext !== beforeNext, 'next and previous tab ids differ')

  // openSettings — Ctrl+,
  await page.keyboard.down('Control')
  await page.keyboard.press('Comma')
  await page.keyboard.up('Control')
  await page.locator('[data-testid="settings-back"]').waitFor({ state: 'visible', timeout: 10_000 })
  assert(
    await page.locator('[data-testid="settings-back"]').isVisible(),
    'Ctrl+, opened settings'
  )

  // Back to terminal so zoom targets chrome UI zoom while terminal view is active
  await page.locator('[data-testid="settings-back"]').click()
  await waitFor(
    page,
    () => !document.querySelector('[data-testid="settings-back"]'),
    undefined,
    'settings did not close'
  )

  // zoomIn — Ctrl+=
  await page.keyboard.down('Control')
  await page.keyboard.press('Equal')
  await page.keyboard.up('Control')
  await waitFor(
    page,
    async (previous) => {
      const settings = await window.zinc.settings.get()
      return settings.FontSize > previous
    },
    startFontSize,
    'Ctrl+= did not increase FontSize'
  )
  const afterZoomIn = await page.evaluate(async () => (await window.zinc.settings.get()).FontSize)

  // zoomOut — Ctrl+-
  await page.keyboard.down('Control')
  await page.keyboard.press('Minus')
  await page.keyboard.up('Control')
  await waitFor(
    page,
    async (previous) => {
      const settings = await window.zinc.settings.get()
      return settings.FontSize < previous
    },
    afterZoomIn,
    'Ctrl+- did not decrease FontSize'
  )

  // resetZoom — Ctrl+0
  await page.keyboard.down('Control')
  await page.keyboard.press('Digit0')
  await page.keyboard.up('Control')
  await waitFor(
    page,
    async () => {
      const settings = await window.zinc.settings.get()
      return settings.FontSize === 16
    },
    undefined,
    'Ctrl+0 did not reset FontSize to 16'
  )

  // closeTab — Ctrl+Shift+W (close the extra test tab created by shortcut)
  const beforeClose = await page.evaluate(() => window.__zincTabs.tabs.length)
  assert(beforeClose >= 2, 'need at least two tabs before close-tab shortcut')
  await page.keyboard.down('Control')
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyW')
  await page.keyboard.up('Shift')
  await page.keyboard.up('Control')
  await waitFor(
    page,
    (count) => window.__zincTabs.tabs.length === count - 1,
    beforeClose,
    'Ctrl+Shift+W did not close a tab'
  )

  // Ensure baseline restore still has a terminal (runSmoke cleans extra tabs)
  void baseline
  void createTestTab
})

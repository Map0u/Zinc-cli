// Ad-hoc driver for a packaged Zinc over CDP (used for VM repro of the
// Claude background-resume bug). Usage:
//   node tests/cdp/zinc-drive.mjs screen
//   node tests/cdp/zinc-drive.mjs type "text"      (insertText + Enter)
//   node tests/cdp/zinc-drive.mjs raw "text"       (insertText, no Enter)
//   node tests/cdp/zinc-drive.mjs key Escape|ArrowDown|Enter|...
//   node tests/cdp/zinc-drive.mjs tab <n>          (click nth tab, 0-based)
//   node tests/cdp/zinc-drive.mjs newtab
//   node tests/cdp/zinc-drive.mjs quit             (close window → before-quit persists)
import { chromium } from 'playwright-core'

const endpoint = process.env.ZINC_CDP_ENDPOINT || 'http://127.0.0.1:19337'
const [cmd, arg] = process.argv.slice(2)

const browser = await chromium.connectOverCDP(endpoint, { timeout: 20_000 })
const page = browser.contexts()[0].pages()[0]
await page.waitForLoadState('domcontentloaded')

const shown = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true })

async function focusTerminal() {
  await page.evaluate((shownSrc) => {
    const shown = eval(shownSrc)
    const host = Array.from(document.querySelectorAll('.xterm')).find(shown)
    host?.querySelector('.xterm-helper-textarea')?.focus()
  }, shown.toString())
}

async function screen() {
  return page.evaluate((shownSrc) => {
    const shown = eval(shownSrc)
    const hosts = Array.from(document.querySelectorAll('.xterm')).filter(shown)
    return hosts
      .map((h) => Array.from(h.querySelectorAll('.xterm-rows > div')).map((r) => r.textContent.replace(/\s+$/, '')).join('\n'))
      .join('\n=====\n')
      .replace(/\n{3,}/g, '\n\n')
  }, shown.toString())
}

switch (cmd) {
  case 'type':
    await focusTerminal()
    await page.keyboard.insertText(arg)
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    break
  case 'raw':
    await focusTerminal()
    await page.keyboard.insertText(arg)
    break
  case 'key':
    await focusTerminal()
    await page.keyboard.press(arg)
    break
  case 'tab':
    await page.locator('[role="tab"]').nth(Number(arg)).click()
    break
  case 'newtab':
    await focusTerminal()
    await page.keyboard.press('Control+Shift+T')
    break
  case 'quit':
    await page.evaluate(() => window.close())
    break
}
if (cmd !== 'quit') {
  await page.waitForTimeout(Number(process.env.WAIT_MS || 1500))
  console.log(await screen())
}
await browser.close().catch(() => {})

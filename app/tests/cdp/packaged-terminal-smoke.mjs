import { chromium } from 'playwright-core'

const endpoint = process.env.ZINC_CDP_ENDPOINT || 'http://127.0.0.1:9337'
const marker = `ZINC-PACKAGED-${Date.now().toString(36)}`
const encodedMarker = Buffer.from(marker, 'utf8').toString('base64')
const command = `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedMarker}')) | Write-Output`
let browser

try {
  if (command.includes(marker)) throw new Error('Packaged smoke command leaked its expected marker.')

  browser = await chromium.connectOverCDP(endpoint, { timeout: 20_000 })
  const context = browser.contexts()[0]
  if (!context) throw new Error('Packaged Zinc did not expose a browser context.')
  const page = context.pages()[0] || (await context.waitForEvent('page', { timeout: 20_000 }))
  await page.waitForLoadState('domcontentloaded')

  const terminalInput = page.locator('.xterm-helper-textarea').first()
  await terminalInput.waitFor({ state: 'visible', timeout: 20_000 })
  await terminalInput.click()
  await page.keyboard.insertText(command)
  await page.keyboard.press('Enter')

  await page.waitForFunction(
    (expected) => Array.from(document.querySelectorAll('.xterm-rows')).some((element) => element.textContent?.includes(expected)),
    marker,
    { timeout: 20_000 }
  )
  console.log('PASS: packaged Zinc launched a PowerShell terminal and produced verified output.')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`FAIL: packaged Zinc terminal smoke: ${redact(message)}`)
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
}

function redact(value) {
  return value
    .replace(/[A-Za-z]:[\\/][^\r\n]*/g, '<redacted-path>')
    .replace(/\\\\[^\r\n]*/g, '<redacted-path>')
    .replace(/\/(?:home|mnt|tmp|Users)\/[^\s)]+/g, '<redacted-path>')
}

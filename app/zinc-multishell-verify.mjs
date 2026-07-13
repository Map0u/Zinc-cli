import { assert, runSmoke, waitFor } from './tests/cdp/smoke-helpers.mjs'

// Multi-shell smoke: real discovery results on this machine, plus an actual
// non-PowerShell tab proving PtyManager no longer applies pwsh flags blindly.
await runSmoke('multishell discovery and cmd tab', async ({ page }) => {
  // The IPC returns { profiles, fallbackNotice }, not a bare array.
  const profiles = await page.evaluate(() =>
    Promise.resolve(window.zinc.shells.getProfiles()).then((result) => result.profiles)
  )
  assert(Array.isArray(profiles) && profiles.length > 0, 'shell discovery returned at least one profile')
  console.log(`detected shells: ${profiles.map((p) => p.id).join(', ')}`)

  for (const required of ['pwsh', 'windows-powershell', 'cmd']) {
    assert(profiles.some((p) => p.id === required), `discovery found ${required} on this machine`)
  }
  const ids = profiles.map((p) => p.id)
  assert(new Set(ids).size === ids.length, 'discovered shell ids are unique')

  const before = await page.evaluate(() => window.__zincTabs.tabs.map((tab) => tab.id))
  await page.evaluate(() => window.__zincTabs.addTab({ shellId: 'cmd', shellLabel: 'Command Prompt' }))
  await waitFor(
    page,
    (existingIds) => Boolean(window.__zincTabs.activeId && !existingIds.includes(window.__zincTabs.activeId)),
    before,
    'cmd test tab was not created'
  )
  const cmdTabId = await page.evaluate(() => window.__zincTabs.activeId)
  await waitFor(
    page,
    (tabId) => {
      const entry = window.__zincRegistry.hosts?.get(tabId)
      return Boolean(entry && entry.state === 'ready' && entry.term.cols > 1 && entry.term.rows > 0)
    },
    cmdTabId,
    'cmd test terminal did not become ready'
  )

  const tabModel = await page.evaluate((id) => window.__zincTabs.tabs.find((tab) => tab.id === id), cmdTabId)
  assert(tabModel?.shellId === 'cmd', 'new tab persists the cmd stable shell id', JSON.stringify(tabModel?.shellId))

  const nonce = Math.floor(performance.now()).toString(36)
  const marker = `ZINC-CMD-${nonce}`
  await page.evaluate((id) => window.__zincRegistry.focus(id), cmdTabId)
  await page.keyboard.insertText(`echo ${marker}-OK`)
  await page.keyboard.press('Enter')
  await waitFor(
    page,
    ({ id, text }) => window.__zincRegistry.getBufferText(id).includes(text),
    { id: cmdTabId, text: `${marker}-OK` },
    'cmd shell did not echo the marker (PowerShell flags likely leaked into cmd argv)'
  )

  // cmd must NOT have been started through PowerShell: `$PSVersionTable` in
  // cmd prints the literal token back rather than a table.
  const buffer = await page.evaluate((id) => window.__zincRegistry.getBufferText(id), cmdTabId)
  assert(!buffer.includes('-NoLogo'), 'cmd tab buffer shows no leaked PowerShell arguments')
})

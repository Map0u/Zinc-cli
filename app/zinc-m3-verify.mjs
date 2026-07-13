import { assert, requireIsolatedTestProfile, runSmoke, waitFor } from './tests/cdp/smoke-helpers.mjs'

if (requireIsolatedTestProfile()) {
  await runSmoke('m3 settings and session smoke', async ({ page, baseline }) => {
    await page.locator('[data-testid="open-settings"]').click()
    await page.locator('[data-testid="settings-back"]').waitFor({ state: 'visible' })

    await page.locator('[data-cat="appearance"]').click()
    const fontSize = baseline.settings.FontSize === 18 ? 19 : 18
    await page.locator('[data-testid="setting-fontSize"]').fill(String(fontSize))
    await waitFor(
      page,
      (expected) => Promise.resolve(window.zinc.settings.get()).then((settings) => settings.FontSize === expected),
      fontSize,
      'font size change was not applied'
    )
    assert(
      Number(await page.locator('[data-testid="setting-fontSize"]').inputValue()) === fontSize,
      'font size control reflects the applied value'
    )

    await page.locator('[data-cat="session"]').click()
    const restoreTarget = !baseline.settings.RestoreSessionsOnStartup
    await page.locator('[data-testid="setting-restoreSessions"]').click()
    await waitFor(
      page,
      (expected) => Promise.resolve(window.zinc.settings.get()).then((settings) => settings.RestoreSessionsOnStartup === expected),
      restoreTarget,
      'restore-sessions toggle did not apply'
    )

    const resumeTarget = !baseline.settings.ResumeAiConversations
    await page.locator('[data-testid="setting-resumeAi"]').click()
    await waitFor(
      page,
      (expected) => Promise.resolve(window.zinc.settings.get()).then((settings) => settings.ResumeAiConversations === expected),
      resumeTarget,
      'resume-AI toggle did not apply'
    )

    if (!restoreTarget) {
      const disabledPayload = await page.evaluate(() => window.zinc.session.getRestorePayload())
      assert(disabledPayload === null, 'disabled session restore returns no startup restore payload')
    } else {
      const payload = await page.evaluate(() => window.zinc.session.getRestorePayload())
      assert(
        payload === null || (Array.isArray(payload.tabs) && Number.isInteger(payload.activeIndex)),
        'enabled session restore returns a valid payload shape when state exists'
      )
    }

    await page.locator('[data-testid="settings-back"]').click()
    await waitFor(
      page,
      () => Boolean(window.__zincTabs.activeId && window.__zincRegistry.hosts?.get(window.__zincTabs.activeId)?.state === 'ready'),
      undefined,
      'terminal did not recover after returning from settings'
    )
  })
}

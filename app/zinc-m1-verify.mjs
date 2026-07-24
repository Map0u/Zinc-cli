import {
  assert,
  assertTerminalGeometry,
  createTestTab,
  powerShellUtf8WriteLine,
  runPowerShellCommand,
  runSmoke,
  setSetting,
  terminalBufferTrace,
  terminalGeometry,
  waitFor
} from './tests/cdp/smoke-helpers.mjs'

function assertBufferTrace(trace, expectedMarkers, label, requireScrollback = false) {
  assert(trace, `${label}: terminal buffer trace exists`)
  assert(trace.state === 'ready', `${label}: terminal remains ready`, String(trace.state))
  assert(trace.activeBuffer === 'normal', `${label}: PowerShell uses the normal xterm buffer`, trace.activeBuffer)

  const positions = []
  for (const marker of expectedMarkers) {
    const markerTrace = trace.markers.find((entry) => entry.marker === marker)
    const lines = markerTrace?.lines ?? []
    assert(lines.length === 1, `${label}: ${marker} occurs exactly once in normal buffer`, lines.join(','))
    if (requireScrollback) {
      assert(
        lines[0] < trace.baseY,
        `${label}: ${marker} is protected in scrollback above the live PowerShell viewport`,
        `line=${lines[0]}, baseY=${trace.baseY}`
      )
    }
    positions.push(`${marker}@${lines[0]}`)
  }

  console.log(
    `trace: ${label}: ${trace.cols}x${trace.rows}, length=${trace.length}, baseY=${trace.baseY}, ` +
      `viewportY=${trace.viewportY}, ${positions.join(', ')}`
  )
}

async function waitForTerminalDimensionsChange(page, tabId, before, label) {
  await waitFor(
    page,
    ({ id, cols, rows }) => {
      const entry = window.__zincRegistry.hosts?.get(id)
      return Boolean(entry?.term && (entry.term.cols !== cols || entry.term.rows !== rows))
    },
    { id: tabId, cols: before.cols, rows: before.rows },
    `${label}: terminal dimensions did not follow the layout change`
  )
}

async function pushLiveViewportIntoScrollback(page, tabId, nonce, phase) {
  const geometry = await terminalGeometry(page, tabId)
  assertTerminalGeometry(geometry, `${phase}: pre-scrollback-fill layout`)
  const readyMarker = `ZINC-SCROLLBACK-${phase}-${nonce}`
  const fillerLineCount = Math.max(64, geometry.rows * 2)
  await runPowerShellCommand(
    page,
    tabId,
    `1..${fillerLineCount} | ForEach-Object { [Console]::WriteLine(('ZINC-FILL-{0:D4}' -f $_)) }; ` +
      powerShellUtf8WriteLine(readyMarker),
    readyMarker
  )
}

await runSmoke('m1 terminal input and layout', async ({ page, baseline }) => {
  const tabId = await createTestTab(page)
  const nonce = Date.now().toString(36)
  const asciiMarker = `ZINC-ASCII-${nonce}`
  const cjkMarker = `ZINC-中文-${nonce}`

  await runPowerShellCommand(
    page,
    tabId,
    powerShellUtf8WriteLine(asciiMarker),
    asciiMarker
  )
  await runPowerShellCommand(
    page,
    tabId,
    powerShellUtf8WriteLine(cjkMarker),
    cjkMarker
  )

  assertBufferTrace(
    await terminalBufferTrace(page, tabId, [asciiMarker, cjkMarker]),
    [asciiMarker, cjkMarker],
    'completed ASCII and CJK output'
  )

  // Protect the output markers before asking PSReadLine to render a very long
  // editable command. Current-screen rows belong to the shell and may be
  // repainted; normal-buffer scrollback is the persistence surface Zinc owns.
  await pushLiveViewportIntoScrollback(page, tabId, nonce, 'BEFORE-LONG')
  assertBufferTrace(
    await terminalBufferTrace(page, tabId, [asciiMarker, cjkMarker]),
    [asciiMarker, cjkMarker],
    'historical output before long-input editing',
    true
  )

  const longInputMarker = `ZINC-LONG-${nonce}`
  const pendingInputMarker = `ZINC-PENDING-${nonce}-中文-ABC`
  const longInput = `${pendingInputMarker}-`.repeat(48)
  const pendingCommand = `$zincSmoke='${longInput}'; ${powerShellUtf8WriteLine(longInputMarker)}`
  assert(
    !pendingCommand.includes(longInputMarker),
    'long-input command source does not contain its completion marker',
    longInputMarker
  )

  await page.evaluate((id) => window.__zincRegistry.focus(id), tabId)
  await page.keyboard.insertText(pendingCommand)
  await waitFor(
    page,
    ({ id, marker }) => window.__zincRegistry.getBufferText(id).includes(marker),
    { id: tabId, marker: pendingInputMarker },
    'long bilingual input did not appear in the live xterm buffer before submit'
  )

  const pendingGeometry = await terminalGeometry(page, tabId)
  assertTerminalGeometry(pendingGeometry, 'pending long-input layout')

  const pendingCursor = await page.evaluate((id) => {
    const entry = window.__zincRegistry.hosts?.get(id)
    const screen = entry?.term?.element?.querySelector('.xterm-screen')
    const viewport = entry?.term?.element?.querySelector('.xterm-viewport')
    const cell = entry?.term?._core?._renderService?.dimensions?.css?.cell
    if (!entry || !screen || !viewport || !cell) return null

    const screenRect = screen.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    const buffer = entry.term.buffer.active
    return {
      left: screenRect.left + buffer.cursorX * cell.width,
      right: screenRect.left + (buffer.cursorX + 1) * cell.width,
      top: screenRect.top + buffer.cursorY * cell.height,
      bottom: screenRect.top + (buffer.cursorY + 1) * cell.height,
      viewport: {
        left: viewportRect.left,
        right: viewportRect.right,
        top: viewportRect.top,
        bottom: viewportRect.bottom
      }
    }
  }, tabId)
  assert(pendingCursor, 'pending long-input cursor geometry exists')
  const cursorTolerance = 1.25
  assert(
    pendingCursor.left >= pendingCursor.viewport.left - cursorTolerance &&
      pendingCursor.right <= pendingCursor.viewport.right + cursorTolerance,
    'pending long-input cursor remains horizontally visible',
    `${pendingCursor.left}..${pendingCursor.right} vs ${pendingCursor.viewport.left}..${pendingCursor.viewport.right}`
  )
  assert(
    pendingCursor.top >= pendingCursor.viewport.top - cursorTolerance &&
      pendingCursor.bottom <= pendingCursor.viewport.bottom + cursorTolerance,
    'pending long-input cursor remains vertically visible',
    `${pendingCursor.top}..${pendingCursor.bottom} vs ${pendingCursor.viewport.top}..${pendingCursor.viewport.bottom}`
  )

  await page.keyboard.press('Enter')
  await waitFor(
    page,
    ({ id, marker }) => window.__zincRegistry.getBufferText(id).includes(marker),
    { id: tabId, marker: longInputMarker },
    'long bilingual input did not execute after submit'
  )

  assertTerminalGeometry(await terminalGeometry(page, tabId), 'submitted long-input layout')

  const retainedMarkers = [asciiMarker, cjkMarker, longInputMarker]
  assertBufferTrace(
    await terminalBufferTrace(page, tabId, [asciiMarker, cjkMarker]),
    [asciiMarker, cjkMarker],
    'historical output after long-input editing',
    true
  )
  assertBufferTrace(
    await terminalBufferTrace(page, tabId, [longInputMarker]),
    [longInputMarker],
    'completed long-input output'
  )

  // Move every retained marker above the live PSReadLine viewport. PowerShell
  // is allowed to repaint its current prompt when ConPTY reports a resize; a
  // marker left on that live screen is therefore not a valid scrollback
  // invariant. Two viewports of output is safely below the isolated profile's
  // default scrollback while guaranteeing the markers are historical rows.
  await pushLiveViewportIntoScrollback(page, tabId, nonce, 'BEFORE-RESIZE')
  assertBufferTrace(
    await terminalBufferTrace(page, tabId, retainedMarkers),
    retainedMarkers,
    'pre-resize historical output',
    true
  )

  const resized = {
    width: Math.max(900, baseline.viewport.width - 137),
    height: Math.max(560, baseline.viewport.height - 83)
  }
  if (resized.width === baseline.viewport.width) resized.width += 91
  if (resized.height === baseline.viewport.height) resized.height += 67
  const beforeViewportResize = await terminalGeometry(page, tabId)
  await page.setViewportSize(resized)
  await waitFor(
    page,
    (expected) => window.innerWidth === expected.width && window.innerHeight === expected.height,
    resized,
    'renderer viewport did not resize'
  )
  await waitForTerminalDimensionsChange(page, tabId, beforeViewportResize, 'resized layout')
  assertTerminalGeometry(await terminalGeometry(page, tabId), 'resized layout')
  assertBufferTrace(
    await terminalBufferTrace(page, tabId, retainedMarkers),
    retainedMarkers,
    'resized historical output',
    true
  )

  const beforeViewportRestore = await terminalGeometry(page, tabId)
  await page.setViewportSize(baseline.viewport)
  await waitForTerminalDimensionsChange(page, tabId, beforeViewportRestore, 'restored layout')
  assertTerminalGeometry(await terminalGeometry(page, tabId), 'restored layout')

  // 0.6.0 removed the AI usage status bar — terminal content band fills the card.
  const layoutFill = await page.evaluate((id) => {
    const entry = window.__zincRegistry.hosts?.get(id)
    if (!entry?.container) return null
    const host = entry.container.closest('.absolute.inset-0')
    if (!(host instanceof HTMLElement)) return null
    const hostRect = host.getBoundingClientRect()
    const terminalRect = entry.container.getBoundingClientRect()
    return {
      hostBottom: hostRect.bottom,
      terminalBottom: terminalRect.bottom,
      hostHeight: hostRect.height,
      terminalHeight: terminalRect.height
    }
  }, tabId)
  assert(layoutFill, 'terminal layout fill geometry exists')
  assert(
    layoutFill.terminalBottom <= layoutFill.hostBottom + 1.25,
    'terminal host fills the content band without a reserved status strip',
    `${layoutFill.terminalBottom} > ${layoutFill.hostBottom}`
  )
  assert(
    layoutFill.terminalHeight >= layoutFill.hostHeight * 0.85,
    'terminal uses the majority of the content band height',
    `${layoutFill.terminalHeight} / ${layoutFill.hostHeight}`
  )

  assertBufferTrace(
    await terminalBufferTrace(page, tabId, retainedMarkers),
    retainedMarkers,
    'final historical output after viewport changes',
    true
  )
  const finalBuffer = await page.evaluate((id) => window.__zincRegistry.getBufferText(id), tabId)
  assert(finalBuffer.includes(asciiMarker), 'pre-resize left-edge marker remains in the xterm buffer')
  assert(finalBuffer.includes(longInputMarker), 'long-input completion marker remains after resize')
})

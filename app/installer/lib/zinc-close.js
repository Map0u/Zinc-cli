async function closeZincWithPolicy(state, options, dependencies) {
  const { forceClose = false, interactive = false } = options || {}
  const { isRunning, requestGracefulExit, waitForExit, forceCloseProcess } = dependencies

  if (!(await isRunning())) return { closed: true, method: 'not-running' }

  if (forceClose) {
    await forceCloseProcess()
    await assertStopped(isRunning)
    return { closed: true, method: 'forced' }
  }

  await requestGracefulExit(state)
  if (await waitForExit()) return { closed: true, method: 'graceful' }

  if (interactive) return { requiresForceCloseConfirmation: true }

  // Headless upgrade automation cannot prompt. This is also the compatibility
  // path for older Zinc versions that do not understand the graceful request.
  await forceCloseProcess()
  await assertStopped(isRunning)
  return { closed: true, method: 'forced-fallback' }
}

async function assertStopped(isRunning) {
  if (await isRunning()) throw new Error('Zinc is still running and could not be closed.')
}

module.exports = { closeZincWithPolicy }

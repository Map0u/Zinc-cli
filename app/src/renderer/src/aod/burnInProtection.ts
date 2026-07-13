export interface BurnInController {
  start(): void
  stop(): void
  wake(durationMs?: number): void
  getState(): { offsetX: number; offsetY: number; blackout: boolean }
}

export function createBurnInController(options: {
  root: HTMLElement
  enabled: () => boolean
  active: () => boolean
  now?: () => Date
}): BurnInController {
  const now = options.now ?? (() => new Date())
  const positions = [
    { x: -16, y: -16 },
    { x: 0, y: -16 },
    { x: 16, y: -16 },
    { x: 16, y: 0 },
    { x: 16, y: 16 },
    { x: 0, y: 16 },
    { x: -16, y: 16 },
    { x: -16, y: 0 },
    { x: 0, y: 0 }
  ]

  let offsetX = 0
  let offsetY = 0
  let blackout = false
  let started = false
  let minuteTimer: number | null = null
  let blackoutTimer: number | null = null
  let wakeUntil = 0
  let positionIndex = 0
  let anchorIndex = 0
  let anchorStartedAt = now().getTime()

  function isEnabledAndActive(): boolean {
    return options.enabled() && options.active()
  }

  function inBlackoutWindow(date: Date): boolean {
    const hour = date.getHours()
    return hour >= 3 && hour < 8
  }

  function setOffset(x: number, y: number): void {
    offsetX = x
    offsetY = y
    options.root.style.setProperty('--aod-offset-x', `${x}px`)
    options.root.style.setProperty('--aod-offset-y', `${y}px`)
  }

  function setBlackout(next: boolean): void {
    if (blackout === next) return
    blackout = next
    window.zinc.aod.setBlackoutActive(next)
    if (next) document.documentElement.dataset.aodBlackout = '1'
    else delete document.documentElement.dataset.aodBlackout
  }

  function resetVisualState(): void {
    setOffset(0, 0)
    setBlackout(false)
  }

  function syncBlackout(): void {
    if (!isEnabledAndActive()) {
      resetVisualState()
      return
    }
    const time = now().getTime()
    setBlackout(inBlackoutWindow(new Date(time)) && time >= wakeUntil)
  }

  function advanceOffset(): void {
    if (!isEnabledAndActive()) {
      resetVisualState()
      return
    }
    const time = now().getTime()
    if (time - anchorStartedAt >= 30 * 60 * 1000) {
      anchorStartedAt = time
      anchorIndex = (anchorIndex + 1) % positions.length
    }
    const pos = positions[(positionIndex + anchorIndex) % positions.length]
    positionIndex = (positionIndex + 1) % positions.length
    setOffset(pos.x, pos.y)
    syncBlackout()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!blackout || !isEnabledAndActive()) return
    event.preventDefault()
    event.stopImmediatePropagation()
    controller.wake()
  }

  const controller: BurnInController = {
    start() {
      if (started) {
        syncBlackout()
        return
      }
      started = true
      advanceOffset()
      minuteTimer = window.setInterval(advanceOffset, 60 * 1000)
      blackoutTimer = window.setInterval(syncBlackout, 15 * 1000)
      window.addEventListener('keydown', onKeydown, true)
    },
    stop() {
      if (!started) return
      started = false
      if (minuteTimer !== null) window.clearInterval(minuteTimer)
      if (blackoutTimer !== null) window.clearInterval(blackoutTimer)
      minuteTimer = null
      blackoutTimer = null
      window.removeEventListener('keydown', onKeydown, true)
      wakeUntil = 0
      resetVisualState()
    },
    wake(durationMs = 60 * 1000) {
      wakeUntil = now().getTime() + durationMs
      syncBlackout()
    },
    getState() {
      return { offsetX, offsetY, blackout }
    }
  }

  return controller
}

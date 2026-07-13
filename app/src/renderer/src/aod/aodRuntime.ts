/// <reference path="../../../preload/index.d.ts" />

export interface AodState {
  active: boolean
}

let currentState: AodState = window.zinc.aod.getStateSync()
const listeners = new Set<(state: AodState) => void>()
const wakeListeners = new Set<() => void>()

function applyAodAttribute(state: AodState): void {
  if (state.active) document.documentElement.dataset.aod = '1'
  else {
    delete document.documentElement.dataset.aod
    delete document.documentElement.dataset.aodBlackout
  }
}

applyAodAttribute(currentState)

window.zinc.aod.onChange((state) => {
  currentState = state
  applyAodAttribute(state)
  for (const listener of listeners) listener(state)
})

window.zinc.aod.onWake(() => {
  for (const listener of wakeListeners) listener()
})

export function getAodState(): AodState {
  return currentState
}

export function subscribeAod(listener: (state: AodState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function subscribeAodWake(listener: () => void): () => void {
  wakeListeners.add(listener)
  return () => wakeListeners.delete(listener)
}

export function requestAodExit(): void {
  window.zinc.aod.requestExit()
}

export function wakeAod(): void {
  window.zinc.aod.wake()
}

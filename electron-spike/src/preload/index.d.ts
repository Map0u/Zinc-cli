import type { ZincTerminalApi } from './index'

declare global {
  interface Window {
    zinc: ZincTerminalApi
  }
}

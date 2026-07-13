import type { ZincApi } from './index'

declare global {
  interface Window {
    zinc: ZincApi
  }
}

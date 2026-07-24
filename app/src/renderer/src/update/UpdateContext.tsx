import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { UpdateState } from '../../../shared/updateProtocol'
import { isUpdateBadgeVisible } from '../../../shared/updateProtocol'

interface UpdateContextValue {
  state: UpdateState | null
  dialogOpen: boolean
  openDialog: () => void
  closeDialog: () => void
  showBadge: boolean
  check: () => Promise<UpdateState>
  install: () => Promise<UpdateState>
  busy: boolean
}

const UpdateContext = createContext<UpdateContextValue | null>(null)

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    void window.zinc.update.getState().then((next) => {
      if (mounted) setState(next)
    })
    const unsubscribe = window.zinc.update.onState((next) => {
      if (mounted) setState(next)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const check = useCallback(async () => {
    const next = await window.zinc.update.check()
    setState(next)
    return next
  }, [])

  const install = useCallback(async () => {
    const next = await window.zinc.update.install()
    setState(next)
    return next
  }, [])

  const value = useMemo<UpdateContextValue>(() => {
    const status = state?.status
    const busy = status === 'checking' || status === 'downloading'
    return {
      state,
      dialogOpen,
      openDialog: () => setDialogOpen(true),
      closeDialog: () => setDialogOpen(false),
      showBadge: status != null && isUpdateBadgeVisible(status),
      check,
      install,
      busy
    }
  }, [state, dialogOpen, check, install])

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
}

export function useUpdate(): UpdateContextValue {
  const ctx = useContext(UpdateContext)
  if (!ctx) throw new Error('useUpdate must be used within UpdateProvider')
  return ctx
}

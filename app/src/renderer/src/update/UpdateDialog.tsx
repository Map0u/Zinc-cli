import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { SegoeIcon } from '../segoeFluentIcons'
import { findChangelogEntry } from './changelogEntries'
import { useUpdate } from './UpdateContext'

function notesForDialog(
  releaseNotes: string | null | undefined,
  version: string | null | undefined,
  language: 'en' | 'zh'
): { kind: 'text'; text: string } | { kind: 'bullets'; items: string[] } {
  if (releaseNotes && releaseNotes.trim()) {
    return { kind: 'text', text: releaseNotes.trim() }
  }
  const entry = findChangelogEntry(version)
  if (entry) {
    return { kind: 'bullets', items: language === 'zh' ? entry.zh : entry.en }
  }
  return { kind: 'text', text: '' }
}

export function UpdateDialog() {
  const { t, language } = useI18n()
  const { state, dialogOpen, closeDialog, check, install, busy } = useUpdate()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!dialogOpen) return
    returnFocusRef.current = document.activeElement as HTMLElement | null
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      returnFocusRef.current?.focus()
      returnFocusRef.current = null
    }
  }, [dialogOpen])

  if (!dialogOpen || !state) return null

  const version =
    state.downloadedVersion ?? state.availableVersion ?? state.currentVersion
  const notes = notesForDialog(state.releaseNotes, version, language)
  const percent = state.percent === null ? null : Math.round(state.percent)
  const canInstall = state.status === 'downloaded'
  const canRetry = state.status === 'error' || state.status === 'not-available' || state.status === 'idle'
  const primaryDisabled =
    busy || state.status === 'disabled' || (!canInstall && !canRetry && state.status !== 'available')

  let primaryLabel = t('UpdateDialogActionUpdate')
  if (state.status === 'checking') primaryLabel = t('AboutUpdateChecking')
  else if (state.status === 'downloading') {
    primaryLabel =
      percent === null
        ? t('AboutUpdateDownloading')
        : `${t('AboutUpdateDownloading')} ${percent}%`
  } else if (state.status === 'downloaded') primaryLabel = t('UpdateDialogActionRestart')
  else if (state.status === 'error') primaryLabel = t('UpdateDialogActionRetry')
  else if (state.status === 'available') primaryLabel = t('UpdateDialogActionDownloading')

  function onPrimary(): void {
    if (canInstall) {
      void install()
      return
    }
    void check()
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDialog()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ) ?? []
    )
    if (focusable.length === 0) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const fallbackNotes = t('UpdateDialogNotesFallback')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-5 py-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        data-testid="update-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex max-h-[min(720px,calc(100vh-3rem))] w-full max-w-[560px] flex-col rounded-lg border border-card-border bg-card-bg shadow-2xl focus:outline-none"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-card-border px-5">
          <h2 id="update-dialog-title" className="text-[14px] font-semibold text-fg-primary">
            {t('UpdateDialogTitle')} {version}
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label={t('UpdateDialogClose')}
            title={t('UpdateDialogClose')}
            onClick={closeDialog}
            className="icon-font flex h-8 w-8 items-center justify-center rounded text-[12px] text-fg-secondary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {SegoeIcon.Close}
          </button>
        </div>

        <div className="chrome-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-[12px] leading-5 text-fg-secondary">{t('UpdateDialogLead')}</p>
          {state.status === 'error' && state.error ? (
            <p className="mt-2 text-[12px] leading-5 text-fg-secondary">{state.error}</p>
          ) : null}
          {state.status === 'downloading' && percent !== null ? (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-control-bg">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-200"
                  style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-fg-tertiary">
                {t('AboutUpdateDownloading')} {percent}%
              </div>
            </div>
          ) : null}

          <h3 className="mt-4 text-[12px] font-semibold text-fg-primary">{t('UpdateDialogNotesTitle')}</h3>
          {notes.kind === 'bullets' ? (
            <ul className="mt-2 flex flex-col gap-1.5 text-[12px] leading-5 text-fg-secondary">
              {notes.items.map((item) => (
                <li key={item} className="pl-3 before:-ml-3 before:pr-2 before:content-['•']">
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-fg-secondary">
              {notes.text || fallbackNotes}
            </p>
          )}
          <p className="mt-4 text-[11px] leading-5 text-fg-tertiary">{t('UpdateDialogRestartHint')}</p>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-card-border px-5 py-3">
          <button
            type="button"
            onClick={closeDialog}
            className="rounded border border-card-border bg-control-bg px-3 py-1.5 text-[12px] text-fg-primary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t('UpdateDialogLater')}
          </button>
          <button
            type="button"
            data-testid="update-dialog-primary"
            disabled={primaryDisabled && !canInstall}
            onClick={onPrimary}
            className="rounded border border-card-border bg-accent px-3 py-1.5 text-[12px] text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-45"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

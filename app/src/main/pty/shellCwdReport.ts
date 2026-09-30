import { win32 } from 'node:path'

const OSC_CWD_PREFIX = '\x1b]7;file:///'
const OSC_CWD = /\x1b\]7;file:\/\/\/([A-Za-z]:\/[^\x07\x1b]{0,4096})\x07/g

/** Read PowerShell prompt's OSC 7 cwd report without assuming PTY chunk boundaries. */
export function createShellCwdReader(onCwd: (cwd: string) => void): (data: string) => void {
  let incomplete = ''
  return (data) => {
    const text = incomplete + data
    incomplete = ''
    for (const match of text.matchAll(OSC_CWD)) {
      try {
        const decoded = decodeURIComponent(match[1]).replace(/\//g, '\\')
        if (win32.isAbsolute(decoded)) onCwd(decoded)
      } catch {
        // Ignore malformed URI escapes from unrelated terminal output.
      }
    }
    const start = text.lastIndexOf(OSC_CWD_PREFIX)
    if (start >= 0 && text.indexOf('\x07', start) < 0 && text.length - start <= 8192) {
      incomplete = text.slice(start)
    }
  }
}

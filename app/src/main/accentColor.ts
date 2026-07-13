import koffi from 'koffi'

/**
 * Reads the Light2 shade of the current Windows system accent color — the
 * exact ARGB value WinUI3's `AccentFillColorDefaultBrush` resolves to in dark
 * theme, confirmed empirically against a runtime dump of the old Zinc.App
 * (WinUI3) build: `AccentPalette` index 1 (of 8, R/G/B/pad little bytes each)
 * equals the resolved brush color on this machine. Reading the OS-cached
 * palette directly (rather than re-deriving Microsoft's internal tint
 * algorithm from the raw accent color) is what lets the Electron chrome track
 * whatever accent color the user has picked in Windows Settings, same as the
 * old app did automatically via ThemeResource lookup.
 */

const HKEY_CURRENT_USER = 0x80000001
const RRF_RT_REG_BINARY = 0x00000008
const ACCENT_LIGHT2_INDEX = 1

interface Bound {
  RegGetValueW: koffi.KoffiFunction
}

let bound: Bound | null | undefined // undefined = not attempted yet, null = attempted and failed

function ensureBound(): Bound | null {
  if (bound !== undefined) return bound
  if (process.platform !== 'win32') {
    bound = null
    return bound
  }
  try {
    const advapi32 = koffi.load('advapi32.dll')
    bound = {
      RegGetValueW: advapi32.func(
        'long __stdcall RegGetValueW(void *hkey, str16 lpSubKey, str16 lpValue, uint32 dwFlags, _Out_ uint32 *pdwType, _Out_ uint8_t *pvData, _Inout_ uint32 *pcbData)'
      )
    }
  } catch {
    bound = null
  }
  return bound
}

function hkeyPtr(value: number): unknown {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(BigInt(value >>> 0))
  return koffi.decode(buf, 'void *')
}

/** `#rrggbb`, or `null` if the registry value is missing/unreadable (non-Windows, locked-down account, etc.). */
export function getSystemAccentLight2(): string | null {
  const lib = ensureBound()
  if (!lib) return null
  try {
    const dataBuf = Buffer.alloc(64)
    const typeOut = [0]
    const sizeInOut = [64]
    const status = lib.RegGetValueW(
      hkeyPtr(HKEY_CURRENT_USER),
      'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent',
      'AccentPalette',
      RRF_RT_REG_BINARY,
      typeOut,
      dataBuf,
      sizeInOut
    )
    if (status !== 0) return null
    const offset = ACCENT_LIGHT2_INDEX * 4
    if (sizeInOut[0] < offset + 3) return null
    const hex = (n: number): string => n.toString(16).padStart(2, '0')
    return `#${hex(dataBuf[offset])}${hex(dataBuf[offset + 1])}${hex(dataBuf[offset + 2])}`
  } catch {
    return null
  }
}

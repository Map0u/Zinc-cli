import koffi from 'koffi'
import { readFileSync, readlinkSync } from 'node:fs'
import { win32 } from 'node:path'

/**
 * Reads another process's current working directory by walking its PEB.
 * Supports same-user native x64 and WOW64 x86 processes. ProcessWow64Information
 * selects the 32-bit PEB when present; otherwise ProcessBasicInformation gives
 * the native PEB. Returns `null` on any
 * failure so callers can fall back to a known-good value (e.g. the shell's
 * resolved startup cwd). WSL processes are handled separately through procfs.
 */

const PROCESS_QUERY_INFORMATION = 0x0400
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const PROCESS_VM_READ = 0x0010
const WINDOWS_TO_UNIX_EPOCH_MS = 11_644_473_600_000n
interface Bound {
  OpenProcess: koffi.KoffiFunction
  CloseHandle: koffi.KoffiFunction
  ReadProcessMemory: koffi.KoffiFunction
  NtQueryInformationProcess: koffi.KoffiFunction
  NtQueryInformationProcessRaw: koffi.KoffiFunction
  GetProcessTimes: koffi.KoffiFunction
  FILETIME: koffi.IKoffiCType
  PROCESS_BASIC_INFORMATION: koffi.IKoffiCType
}

let bound: Bound | null | undefined // undefined = not attempted yet, null = attempted and failed

function ensureBound(): Bound | null {
  if (bound !== undefined) return bound
  if (process.platform !== 'win32') {
    bound = null
    return bound
  }
  try {
    const kernel32 = koffi.load('kernel32.dll')
    const ntdll = koffi.load('ntdll.dll')
    const PROCESS_BASIC_INFORMATION = koffi.struct('PROCESS_BASIC_INFORMATION', {
      ExitStatus: 'intptr_t',
      PebBaseAddress: 'void *',
      AffinityMask: 'intptr_t',
      BasePriority: 'intptr_t',
      UniqueProcessId: 'intptr_t',
      InheritedFromUniqueProcessId: 'intptr_t'
    })
    const FILETIME = koffi.struct('ZINC_FILETIME', {
      dwLowDateTime: 'uint32',
      dwHighDateTime: 'uint32'
    })
    bound = {
      OpenProcess: kernel32.func(
        'void *__stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)'
      ),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *hObject)'),
      ReadProcessMemory: kernel32.func(
        'bool __stdcall ReadProcessMemory(void *hProcess, void *lpBaseAddress, _Out_ uint8_t *lpBuffer, size_t nSize, _Out_ size_t *lpNumberOfBytesRead)'
      ),
      NtQueryInformationProcess: ntdll.func(
        'long __stdcall NtQueryInformationProcess(void *hProcess, uint32 processInformationClass, _Out_ PROCESS_BASIC_INFORMATION *processInformation, uint32 processInformationLength, _Out_ uint32 *returnLength)'
      ),
      NtQueryInformationProcessRaw: ntdll.func(
        'long __stdcall NtQueryInformationProcess(void *hProcess, uint32 processInformationClass, _Out_ uint8_t *processInformation, uint32 processInformationLength, _Out_ uint32 *returnLength)'
      ),
      GetProcessTimes: kernel32.func(
        'bool __stdcall GetProcessTimes(void *hProcess, _Out_ ZINC_FILETIME *lpCreationTime, _Out_ ZINC_FILETIME *lpExitTime, _Out_ ZINC_FILETIME *lpKernelTime, _Out_ ZINC_FILETIME *lpUserTime)'
      ),
      FILETIME,
      PROCESS_BASIC_INFORMATION
    }
  } catch {
    bound = null
  }
  return bound
}

/**
 * Windows process creation time in Unix milliseconds. A PID may be reused;
 * compare both pid and this value before binding a Claude session id to a
 * detected process. Returns null rather than trusting a stale binding if the
 * process has exited or its handle cannot be opened.
 */
export function getProcessStartedMs(pid: number): number | null {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 0) return null
  const lib = ensureBound()
  if (!lib) return null
  const handle = lib.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
  if (!handle) return null
  try {
    const creation: { dwLowDateTime?: number; dwHighDateTime?: number } = {}
    const exit = {}, kernel = {}, user = {}
    if (!lib.GetProcessTimes(handle, creation, exit, kernel, user)) return null
    const ticks = (BigInt(creation.dwHighDateTime ?? 0) << 32n) | BigInt(creation.dwLowDateTime ?? 0)
    const started = ticks / 10_000n - WINDOWS_TO_UNIX_EPOCH_MS
    return started >= 0n && started <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(started) : null
  } catch {
    return null
  } finally {
    lib.CloseHandle(handle)
  }
}

/** Wraps a raw 64-bit address as a `void *` koffi value usable as a pointer argument. */
function toPtr(address: bigint): unknown {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(address & 0xffffffffffffffffn)
  return koffi.decode(buf, 'void *')
}

function readMemory(lib: Bound, handle: unknown, address: bigint, length: number): Buffer | null {
  if (address < 0x1000n || length <= 0) return null
  const result = Buffer.alloc(length)
  const bytesRead = [0]
  if (!lib.ReadProcessMemory(handle, toPtr(address), result, length, bytesRead) || bytesRead[0] !== length) return null
  return result
}

function readPointer(lib: Bound, handle: unknown, address: bigint, width: 4 | 8): bigint | null {
  const bytes = readMemory(lib, handle, address, width)
  if (!bytes) return null
  const pointer = width === 4 ? BigInt(bytes.readUInt32LE(0)) : bytes.readBigUInt64LE(0)
  return pointer >= 0x1000n ? pointer : null
}

interface ProcessParameters {
  address: bigint
  width: 4 | 8
}

function processParametersFor(lib: Bound, handle: unknown): ProcessParameters | null {
  // Zinc ships as x64. ProcessWow64Information (class 26) returns a 32-bit
  // PEB address for WOW64 targets, or zero for native x64 targets. If probing
  // fails, guessing the native offsets could read an unrelated memory region.
  const wow64Peb = Buffer.alloc(8)
  const returned = [0]
  if (lib.NtQueryInformationProcessRaw(handle, 26, wow64Peb, wow64Peb.length, returned) !== 0) return null
  const wow64Address = wow64Peb.readBigUInt64LE(0)
  if (wow64Address !== 0n) {
    const address = readPointer(lib, handle, wow64Address + 0x10n, 4)
    return address === null ? null : { address, width: 4 }
  }
  const pbi: { PebBaseAddress?: unknown } = {}
  if (lib.NtQueryInformationProcess(handle, 0, pbi, koffi.sizeof(lib.PROCESS_BASIC_INFORMATION), returned) !== 0 || !pbi.PebBaseAddress) return null
  const pebAddress = koffi.address(pbi.PebBaseAddress)
  const address = readPointer(lib, handle, pebAddress + 0x20n, 8)
  return address === null ? null : { address, width: 8 }
}

function readUnicodeString(lib: Bound, handle: unknown, parameters: ProcessParameters, offset: number, limit: number): string | null {
  const { address, width } = parameters
  const field = address + BigInt(offset)
  const header = readMemory(lib, handle, field, width === 4 ? 8 : 16)
  if (!header) return null
  const length = header.readUInt16LE(0)
  const maximumLength = header.readUInt16LE(2)
  if (length === 0 || length > limit || length % 2 !== 0 || maximumLength < length || maximumLength % 2 !== 0) return null
  const bufferAddress = width === 4 ? BigInt(header.readUInt32LE(4)) : header.readBigUInt64LE(8)
  const data = readMemory(lib, handle, bufferAddress, length)
  if (!data) return null
  const text = data.toString('utf16le')
  return text && !text.includes('\0') ? text : null
}

/** Best-effort PEB read of `pid`'s current working directory. `null` if anything goes wrong. */
export function getProcessCwd(pid: number): string | null {
  if (process.platform !== 'win32') {
    return getLinuxProcessCwd(pid)
  }

  const lib = ensureBound()
  if (!lib || !pid || pid <= 0) return null

  const hProcess = lib.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid)
  if (!hProcess) return null

  try {
    const parameters = processParametersFor(lib, hProcess)
    if (!parameters) return null
    const path = readUnicodeString(lib, hProcess, parameters, parameters.width === 4 ? 0x24 : 0x38, 4096)
    if (!path) return null
    // Preserve drive, UNC-share and extended-prefix roots including their
    // trailing separator. Non-root directories do not need that separator.
    const root = win32.parse(path).root
    return path.length > root.length ? path.replace(/\\+$/, '') : path
  } catch {
    return null
  } finally {
    lib.CloseHandle(hProcess)
  }
}

/**
 * Best-effort PEB read of `pid`'s full command line (parity §2.2: same PEB walk
 * as `getProcessCwd`, `RTL_USER_PROCESS_PARAMETERS.CommandLine` UNICODE_STRING
 * at +0x70 rather than CurrentDirectory's +0x38). Used by the AI tool detector
 * to regex-match `codex`/`claude` in a descendant process's invocation.
 * `null` on any failure (process gone, unreadable process memory, offsets don't apply).
 */
export function getProcessCommandLine(pid: number): string | null {
  if (process.platform !== 'win32') {
    return getLinuxProcessCommandLine(pid)
  }

  const lib = ensureBound()
  if (!lib || !pid || pid <= 0) return null

  const hProcess = lib.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid)
  if (!hProcess) return null

  try {
    const parameters = processParametersFor(lib, hProcess)
    if (!parameters) return null
    return readUnicodeString(lib, hProcess, parameters, parameters.width === 4 ? 0x40 : 0x70, 8192)
  } catch {
    return null
  } finally {
    lib.CloseHandle(hProcess)
  }
}

function getLinuxProcessCwd(pid: number): string | null {
  if (!pid || pid <= 0) return null
  try {
    const path = readlinkSync(`/proc/${pid}/cwd`)
    return path.length > 0 ? path : null
  } catch {
    return null
  }
}

function getLinuxProcessCommandLine(pid: number): string | null {
  if (!pid || pid <= 0) return null
  try {
    const text = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      .replace(/\0+/g, ' ')
      .trim()
    if (text.length > 0) return text
  } catch {
    // Fall through to /proc/<pid>/comm below.
  }

  try {
    const text = readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

import koffi from 'koffi'
import { readFileSync, readlinkSync } from 'node:fs'

/**
 * Reads another process's current working directory by walking its PEB.
 * Supports same-user x64 processes only. The PEB layout is:
 * PEB+0x20 -> RTL_USER_PROCESS_PARAMETERS,
 * +0x38 -> CurrentDirectory.DosPath UNICODE_STRING). Returns `null` on any
 * failure so callers can fall back to a known-good value (e.g. the shell's
 * resolved startup cwd). WSL processes are handled separately through procfs.
 */

const PROCESS_QUERY_INFORMATION = 0x0400
const PROCESS_VM_READ = 0x0010

interface Bound {
  OpenProcess: koffi.KoffiFunction
  CloseHandle: koffi.KoffiFunction
  ReadProcessMemory: koffi.KoffiFunction
  NtQueryInformationProcess: koffi.KoffiFunction
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
      PROCESS_BASIC_INFORMATION
    }
  } catch {
    bound = null
  }
  return bound
}

/** Wraps a raw 64-bit address as a `void *` koffi value usable as a pointer argument. */
function toPtr(address: bigint): unknown {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(address & 0xffffffffffffffffn)
  return koffi.decode(buf, 'void *')
}

function readPointer(lib: Bound, hProcess: unknown, address: bigint): bigint | null {
  const buf = Buffer.alloc(8)
  const bytesRead = [0]
  const ok = lib.ReadProcessMemory(hProcess, toPtr(address), buf, 8, bytesRead)
  if (!ok) return null
  return buf.readBigUInt64LE(0)
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
    const pbi: { PebBaseAddress?: unknown } = {}
    const returnLength = [0]
    const status = lib.NtQueryInformationProcess(
      hProcess,
      0,
      pbi,
      koffi.sizeof(lib.PROCESS_BASIC_INFORMATION),
      returnLength
    )
    if (status !== 0 || !pbi.PebBaseAddress) return null
    const pebAddr = koffi.address(pbi.PebBaseAddress)

    // PEB+0x20 -> RTL_USER_PROCESS_PARAMETERS*
    const processParameters = readPointer(lib, hProcess, pebAddr + 0x20n)
    if (processParameters === null) return null

    // UNICODE_STRING CurrentDirectory.DosPath at +0x38: USHORT Length, USHORT MaxLength, PWSTR Buffer at +0x8.
    const lengthBuf = Buffer.alloc(2)
    const lenRead = [0]
    const lenOk = lib.ReadProcessMemory(hProcess, toPtr(processParameters + 0x38n), lengthBuf, 2, lenRead)
    if (!lenOk) return null
    const length = lengthBuf.readUInt16LE(0)
    if (length === 0 || length > 4096) return null

    const stringBuffer = readPointer(lib, hProcess, processParameters + 0x38n + 0x8n)
    if (stringBuffer === null || stringBuffer === 0n) return null

    const pathBuf = Buffer.alloc(length)
    const pathRead = [0]
    const pathOk = lib.ReadProcessMemory(hProcess, toPtr(stringBuffer), pathBuf, length, pathRead)
    if (!pathOk) return null

    let path = pathBuf.toString('utf16le').replace(/\0+$/, '').replace(/\\+$/, '')
    // Root paths like "E:" need the backslash back.
    if (/^[A-Za-z]:$/.test(path)) path += '\\'
    return path.length > 0 ? path : null
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
    const pbi: { PebBaseAddress?: unknown } = {}
    const returnLength = [0]
    const status = lib.NtQueryInformationProcess(
      hProcess,
      0,
      pbi,
      koffi.sizeof(lib.PROCESS_BASIC_INFORMATION),
      returnLength
    )
    if (status !== 0 || !pbi.PebBaseAddress) return null
    const pebAddr = koffi.address(pbi.PebBaseAddress)

    const processParameters = readPointer(lib, hProcess, pebAddr + 0x20n)
    if (processParameters === null) return null

    // UNICODE_STRING CommandLine at +0x70: USHORT Length, USHORT MaxLength, PWSTR Buffer at +0x8.
    const lengthBuf = Buffer.alloc(2)
    const lenRead = [0]
    const lenOk = lib.ReadProcessMemory(hProcess, toPtr(processParameters + 0x70n), lengthBuf, 2, lenRead)
    if (!lenOk) return null
    const length = lengthBuf.readUInt16LE(0)
    if (length === 0 || length > 8192) return null

    const stringBuffer = readPointer(lib, hProcess, processParameters + 0x70n + 0x8n)
    if (stringBuffer === null || stringBuffer === 0n) return null

    const commandLineBuf = Buffer.alloc(length)
    const clRead = [0]
    const clOk = lib.ReadProcessMemory(hProcess, toPtr(stringBuffer), commandLineBuf, length, clRead)
    if (!clOk) return null

    const commandLine = commandLineBuf.toString('utf16le').replace(/\0+$/, '')
    return commandLine.length > 0 ? commandLine : null
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

import koffi from "koffi";
import { basename } from "node:path";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { getProcessCommandLine } from "../processCwd";

export type DetectedTool = "codex" | "claude" | null;

export interface ProcessRow {
  pid: number;
  ppid: number;
  exe: string;
}

export interface ActiveToolMatch {
  tool: Exclude<DetectedTool, null>;
  pid: number;
  /** WSL means Windows paths typed into this process must use /mnt/<drive>. */
  runtime: "native" | "wsl";
}

interface WindowsProcessApi {
  snapshot: koffi.KoffiFunction;
  first: koffi.KoffiFunction;
  next: koffi.KoffiFunction;
  close: koffi.KoffiFunction;
  entryType: koffi.IKoffiCType;
}

const PROCESS_SNAPSHOT = 0x00000002;
const TOOL_PATTERNS: ReadonlyArray<
  readonly [Exclude<DetectedTool, null>, RegExp]
> = [
  ["codex", /(?:^|[\\/\s"'])codex(?:\.cmd|\.ps1|\.exe)?(?=$|[\\/\s"'])/i],
  ["claude", /(?:^|[\\/\s"'])claude(?:\.cmd|\.ps1|\.exe)?(?=$|[\\/\s"'])/i],
];

let windowsApi: WindowsProcessApi | null | undefined;

function loadWindowsProcessApi(): WindowsProcessApi | null {
  if (windowsApi !== undefined) return windowsApi;
  if (process.platform !== "win32") return (windowsApi = null);

  try {
    const kernel32 = koffi.load("kernel32.dll");
    const entryType = koffi.struct("ZINC_PROCESSENTRY32W", {
      dwSize: "uint32",
      cntUsage: "uint32",
      th32ProcessID: "uint32",
      th32DefaultHeapID: "uintptr_t",
      th32ModuleID: "uint32",
      cntThreads: "uint32",
      th32ParentProcessID: "uint32",
      pcPriClassBase: "int32",
      dwFlags: "uint32",
      szExeFile: "char16_t[260]",
    });
    windowsApi = {
      snapshot: kernel32.func(
        "void *__stdcall CreateToolhelp32Snapshot(uint32, uint32)",
      ),
      first: kernel32.func(
        "bool __stdcall Process32FirstW(void *, _Inout_ ZINC_PROCESSENTRY32W *)",
      ),
      next: kernel32.func(
        "bool __stdcall Process32NextW(void *, _Inout_ ZINC_PROCESSENTRY32W *)",
      ),
      close: kernel32.func("bool __stdcall CloseHandle(void *)"),
      entryType,
    };
  } catch {
    windowsApi = null;
  }
  return windowsApi;
}

/** Captures a reusable pid/parent/image table without retaining command lines. */
export function snapshotProcesses(): ProcessRow[] {
  return process.platform === "win32"
    ? snapshotWindowsProcesses()
    : snapshotProcfsProcesses();
}

function snapshotWindowsProcesses(): ProcessRow[] {
  const api = loadWindowsProcessApi();
  if (!api) return [];

  const handle = api.snapshot(PROCESS_SNAPSHOT, 0);
  if (!handle) return [];

  const result: ProcessRow[] = [];
  try {
    const entry: {
      dwSize: number;
      th32ProcessID?: number;
      th32ParentProcessID?: number;
      szExeFile?: string;
    } = { dwSize: koffi.sizeof(api.entryType) };

    let hasEntry = api.first(handle, entry);
    while (hasEntry) {
      const pid = entry.th32ProcessID ?? 0;
      if (pid > 0) {
        result.push({
          pid,
          ppid: entry.th32ParentProcessID ?? 0,
          exe: entry.szExeFile ?? "",
        });
      }
      hasEntry = api.next(handle, entry);
    }
  } catch {
    return [];
  } finally {
    try {
      api.close(handle);
    } catch {
      // A failed close must not break a status update.
    }
  }
  return result;
}

function snapshotProcfsProcesses(): ProcessRow[] {
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch {
    return [];
  }

  const result: ProcessRow[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const commandEnd = stat.lastIndexOf(") ");
      if (commandEnd < 0) continue;
      const fields = stat
        .slice(commandEnd + 2)
        .trim()
        .split(/\s+/);
      const ppid = Number(fields[1]);
      if (!Number.isSafeInteger(ppid)) continue;
      result.push({ pid, ppid, exe: procImageName(pid) });
    } catch {
      // Processes routinely exit during enumeration.
    }
  }
  return result;
}

function procImageName(pid: number): string {
  try {
    return basename(readlinkSync(`/proc/${pid}/exe`));
  } catch {
    try {
      return readFileSync(`/proc/${pid}/comm`, "utf8").trim();
    } catch {
      return "";
    }
  }
}

function descendants(rows: ProcessRow[], rootPid: number): ProcessRow[] {
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const group = children.get(row.ppid);
    if (group) group.push(row);
    else children.set(row.ppid, [row]);
  }

  const result: ProcessRow[] = [];
  const queue = [...(children.get(rootPid) ?? [])];
  const visited = new Set<number>();
  while (queue.length > 0) {
    const row = queue.shift()!;
    if (visited.has(row.pid)) continue;
    visited.add(row.pid);
    result.push(row);
    queue.push(...(children.get(row.pid) ?? []));
  }
  return result;
}

function isWslLauncher(row: ProcessRow, commandLine: string): boolean {
  if (process.platform !== "win32") return false;
  if (/^(?:wsl|wslhost)(?:\.exe)?$/i.test(row.exe)) return true;
  return /^\s*"?(?:[^"\r\n]*[\\/])?wsl(?:\.exe)?(?:"|\s|$)/i.test(commandLine);
}

function belongsToWsl(
  candidate: ProcessRow,
  commandLine: string,
  rowsByPid: ReadonlyMap<number, ProcessRow>,
  shellPid: number,
): boolean {
  if (isWslLauncher(candidate, commandLine)) return true;
  let current = rowsByPid.get(candidate.ppid);
  const visited = new Set<number>();
  while (current && current.pid !== shellPid && !visited.has(current.pid)) {
    visited.add(current.pid);
    if (/^(?:wsl|wslhost)(?:\.exe)?$/i.test(current.exe)) return true;
    current = rowsByPid.get(current.ppid);
  }
  return false;
}

/**
 * Finds a supported CLI below a terminal shell. Command lines are read only
 * for descendants and only until a match is found. Codex has deterministic
 * priority when both tools are present.
 */
export function detectActiveToolMatch(
  shellPid: number | null,
  rows = snapshotProcesses(),
): ActiveToolMatch | null {
  if (
    !Number.isSafeInteger(shellPid) ||
    (shellPid ?? 0) <= 0 ||
    rows.length === 0
  )
    return null;

  const candidates = descendants(rows, shellPid!);
  const rowsByPid = new Map(rows.map((row) => [row.pid, row]));
  const commandLines = new Map<number, string | null>();
  const commandFor = (pid: number): string | null => {
    if (!commandLines.has(pid))
      commandLines.set(pid, getProcessCommandLine(pid));
    return commandLines.get(pid) ?? null;
  };

  for (const [tool, pattern] of TOOL_PATTERNS) {
    for (const candidate of candidates) {
      const commandLine = commandFor(candidate.pid);
      if (commandLine && pattern.test(commandLine)) {
        return {
          tool,
          pid: candidate.pid,
          runtime: belongsToWsl(candidate, commandLine, rowsByPid, shellPid!)
            ? "wsl"
            : "native",
        };
      }
    }
  }
  return null;
}

export function detectActiveTool(shellPid: number | null): DetectedTool {
  return detectActiveToolMatch(shellPid)?.tool ?? null;
}

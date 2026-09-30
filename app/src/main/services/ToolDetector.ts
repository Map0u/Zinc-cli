import koffi from "koffi";
import { basename } from "node:path";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { getProcessCommandLine, getProcessStartedMs } from "../processCwd";
import {
  AI_CLI_TOOLS,
  identifyToolFromCommandLine,
  type AiCliTool,
} from "../../shared/aiCliTools";

export type DetectedTool = AiCliTool | null;
export { identifyToolFromCommandLine, AI_CLI_TOOLS };

export interface ProcessRow {
  pid: number;
  ppid: number;
  exe: string;
  /** /proc stat start ticks; Windows creation time is read only for matching CLIs. */
  startedAt?: number;
}

export interface ActiveToolMatch {
  tool: AiCliTool;
  pid: number;
  /** WSL means Windows paths typed into this process must use /mnt/<drive>. */
  runtime: "native" | "wsl";
  /** Command line that identified this tool; used to extract a Codex session id. */
  commandLine: string;
}

interface WindowsProcessApi {
  snapshot: koffi.KoffiFunction;
  first: koffi.KoffiFunction;
  next: koffi.KoffiFunction;
  close: koffi.KoffiFunction;
  entryType: koffi.IKoffiCType;
}

const PROCESS_SNAPSHOT = 0x00000002;
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
  if (!api) throw new Error("Windows process snapshot API unavailable");

  const handle = api.snapshot(PROCESS_SNAPSHOT, 0);
  // CreateToolhelp32Snapshot returns INVALID_HANDLE_VALUE, not NULL, on failure.
  if (!handle || BigInt.asUintN(64, koffi.address(handle)) === BigInt.asUintN(64, -1n))
    throw new Error("CreateToolhelp32Snapshot failed");

  const result: ProcessRow[] = [];
  try {
    const entry: {
      dwSize: number;
      th32ProcessID?: number;
      th32ParentProcessID?: number;
      szExeFile?: string;
    } = { dwSize: koffi.sizeof(api.entryType) };

    let hasEntry = api.first(handle, entry);
    if (!hasEntry) throw new Error("Process32FirstW failed");
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
      const startTicks = Number(fields[19]); // /proc/<pid>/stat field 22
      result.push({
        pid, ppid, exe: procImageName(pid),
        ...(Number.isSafeInteger(startTicks) ? { startedAt: startTicks } : {}),
      });
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
  const wsl = '"?(?:[^"\\r\\n]*[\\\\/])?wsl(?:\\.exe)?(?="|\\s|$)';
  if (new RegExp(`^\\s*${wsl}`, 'i').test(commandLine)) return true;
  // A cmd /c wsl wrapper may be the only visible Windows parent of the CLI.
  return /^(?:cmd(?:\.exe)?)$/i.test(row.exe) &&
    new RegExp(`^\\s*"?(?:[^"\\r\\n]*[\\\\/])?cmd(?:\\.exe)?"?\\s+(?:\\/[ds]\\s+)*\\/(?:c|k)\\s+"?${wsl}`, 'i').test(commandLine);
}

function belongsToWsl(
  candidate: ProcessRow,
  commandLine: string,
  rowsByPid: ReadonlyMap<number, ProcessRow>,
  shellPid: number,
  commandFor: (pid: number) => string | null,
): boolean {
  if (isWslLauncher(candidate, commandLine)) return true;
  let current = rowsByPid.get(candidate.ppid);
  const visited = new Set<number>();
  while (current && current.pid !== shellPid && !visited.has(current.pid)) {
    visited.add(current.pid);
    if (isWslLauncher(current, commandFor(current.pid) ?? '')) return true;
    current = rowsByPid.get(current.ppid);
  }
  return false;
}

/** Find the most recently launched CLI below a terminal shell. A tab's saved
 * tool is only a tie-breaker, never a reason to favor an older descendant. */
export function detectActiveToolMatch(
  shellPid: number | null,
  rows = snapshotProcesses(),
  preferredTool?: AiCliTool | null,
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

  let best: { row: ProcessRow; tool: AiCliTool; commandLine: string; depth: number; startedAt: number | null } | null = null;
  for (const candidate of candidates) {
    const commandLine = commandFor(candidate.pid);
    if (!commandLine) continue;
    const tool = identifyToolFromCommandLine(commandLine);
    if (!tool) continue;
    let depth = 0;
    let parent = candidate;
    const visited = new Set<number>();
    while (parent.pid !== shellPid && !visited.has(parent.pid)) {
      visited.add(parent.pid);
      depth++;
      parent = rowsByPid.get(parent.ppid) ?? { pid: shellPid!, ppid: 0, exe: '' };
    }
    const startedAt = candidate.startedAt ?? getProcessStartedMs(candidate.pid);
    // When creation times are unavailable, PID order is the best available
    // recency signal. A known start time beats distance; distance breaks ties.
    const newer = best && startedAt !== null && best.startedAt !== null && startedAt !== best.startedAt
      ? startedAt > best.startedAt
      : best && depth !== best.depth ? depth < best.depth
      : best && (startedAt === null || best.startedAt === null) && candidate.pid !== best.row.pid
        ? candidate.pid > best.row.pid
        : best && tool === preferredTool && best.tool !== preferredTool
          ? true
          : best && tool !== preferredTool && best.tool === preferredTool
            ? false
            : best ? AI_CLI_TOOLS.indexOf(tool) < AI_CLI_TOOLS.indexOf(best.tool) : true;
    if (newer) best = { row: candidate, tool, commandLine, depth, startedAt };
  }
  if (!best) return null;
  return {
    tool: best.tool,
    pid: best.row.pid,
    runtime: belongsToWsl(best.row, best.commandLine, rowsByPid, shellPid!, commandFor)
      ? 'wsl' : 'native',
    commandLine: best.commandLine,
  };
}

export function detectActiveTool(shellPid: number | null): DetectedTool {
  return detectActiveToolMatch(shellPid)?.tool ?? null;
}

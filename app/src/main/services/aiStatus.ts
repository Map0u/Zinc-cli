import { execFileSync } from "node:child_process";
import {
  closeSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AiStatusSnapshot,
  UsageWindow,
} from "../../shared/aiStatusProtocol";

export type { AiStatusSnapshot, UsageWindow };

type JsonObject = Record<string, unknown>;

interface SessionCandidate {
  path: string;
  mtimeMs: number;
  size: number;
}

interface CachedSnapshot {
  fileStamp: string;
  configStamp: string;
  value: AiStatusSnapshot | null;
}

const EMPTY_WINDOW = (): UsageWindow => ({
  usedPercent: null,
  resetsAtEpoch: null,
});
const SESSION_TAIL_LIMIT = 256 * 1024;
const MAX_CACHE_ENTRIES = 16;
const snapshotCache = new Map<string, CachedSnapshot>();

/** Reads Claude's optional local status-line outputs from the OS temp folder. */
export function readClaude(): AiStatusSnapshot | null {
  const statusPath = join(tmpdir(), "cc_status.json");
  const dailyCost = readOptionalText(join(tmpdir(), "cc_daily.txt"));
  const weeklyCost = readOptionalText(join(tmpdir(), "cc_weekly.txt"));
  const document = readJsonObject(statusPath);

  if (!document && dailyCost == null && weeklyCost == null) return null;
  return {
    label: "Claude",
    model: stringField(document, "model") ?? "Claude",
    effort: stringField(document, "effort") ?? "",
    contextTokens: integerField(document, "context_tokens"),
    primary: usageWindow(objectField(document, "five_hour"), "used_percentage"),
    secondary: usageWindow(
      objectField(document, "seven_day"),
      "used_percentage",
    ),
    dailyCost,
    weeklyCost,
  };
}

/** Returns the newest usable Codex token-count event from the configured roots. */
export function readCodex(codexRoots: string[]): AiStatusSnapshot | null {
  for (const root of codexRoots) {
    if (typeof root !== "string" || !isDirectory(join(root, "sessions")))
      continue;
    const snapshot = readCodexRoot(root);
    if (snapshot) return snapshot;
  }
  return null;
}

function readCodexRoot(root: string): AiStatusSnapshot | null {
  const configPath = join(root, "config.toml");
  const configStamp = fileStamp(configPath);

  for (const file of newestSessionFiles(join(root, "sessions"))) {
    const fileStampValue = `${file.mtimeMs}:${file.size}`;
    const cached = snapshotCache.get(file.path);
    if (
      cached?.fileStamp === fileStampValue &&
      cached.configStamp === configStamp
    ) {
      touchCache(file.path, cached);
      if (cached.value) return cached.value;
      continue;
    }

    const parsed = parseSessionTail(file.path);
    if (!parsed.tokenEvent) {
      remember(file.path, {
        fileStamp: fileStampValue,
        configStamp,
        value: null,
      });
      continue;
    }

    const config = readCodexConfig(configPath);
    const rateLimits = objectField(parsed.tokenEvent, "rate_limits");
    const info = objectField(parsed.tokenEvent, "info");
    const value: AiStatusSnapshot = {
      label: "Codex",
      model: parsed.model ?? config.model ?? "codex",
      effort: parsed.effort ?? config.effort ?? "",
      contextTokens: contextTokenCount(info),
      primary: usageWindow(objectField(rateLimits, "primary"), "used_percent"),
      secondary: usageWindow(
        objectField(rateLimits, "secondary"),
        "used_percent",
      ),
      dailyCost: null,
      weeklyCost: null,
    };
    remember(file.path, { fileStamp: fileStampValue, configStamp, value });
    return value;
  }
  return null;
}

function parseSessionTail(path: string): {
  tokenEvent: JsonObject | null;
  model: string | null;
  effort: string | null;
} {
  let tokenEvent: JsonObject | null = null;
  let model: string | null = null;
  let effort: string | null = null;

  for (const line of readTailLinesNewestFirst(path)) {
    let record: JsonObject | null = null;
    try {
      record = asObject(JSON.parse(line));
    } catch {
      continue;
    }
    const payload = objectField(record, "payload");
    if (!payload) continue;

    if (
      !tokenEvent &&
      stringField(record, "type") === "event_msg" &&
      stringField(payload, "type") === "token_count"
    ) {
      tokenEvent = payload;
    } else if (!model && stringField(record, "type") === "turn_context") {
      model = stringField(payload, "model");
      effort = stringField(payload, "effort");
    }
    if (tokenEvent && model) break;
  }
  return { tokenEvent, model, effort };
}

function newestSessionFiles(sessionsRoot: string): SessionCandidate[] {
  const recentDays: string[] = [];
  outer: for (const year of directoryNames(sessionsRoot).sort().reverse()) {
    for (const month of directoryNames(join(sessionsRoot, year))
      .sort()
      .reverse()) {
      for (const day of directoryNames(join(sessionsRoot, year, month))
        .sort()
        .reverse()) {
        recentDays.push(join(sessionsRoot, year, month, day));
        if (recentDays.length === 3) break outer;
      }
    }
  }

  const candidates: SessionCandidate[] = [];
  for (const day of recentDays) {
    for (const name of fileNames(day, ".jsonl")) {
      const path = join(day, name);
      try {
        const info = statSync(path);
        candidates.push({ path, mtimeMs: info.mtimeMs, size: info.size });
      } catch {
        // A session can disappear while the worker is taking its snapshot.
      }
    }
  }
  return candidates
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 10);
}

function* readTailLinesNewestFirst(path: string): Generator<string> {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, "r");
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, SESSION_TAIL_LIMIT);
    const offset = size - length;
    const bytes = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
      const count = readSync(
        descriptor,
        bytes,
        filled,
        length - filled,
        offset + filled,
      );
      if (count === 0) break;
      filled += count;
    }

    let completeBytes = bytes.subarray(0, filled);
    if (offset > 0) {
      const firstLineEnd = completeBytes.indexOf(0x0a);
      completeBytes =
        firstLineEnd < 0
          ? Buffer.alloc(0)
          : completeBytes.subarray(firstLineEnd + 1);
    }
    const lines = completeBytes.toString("utf8").split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].replace(/\r$/, "");
      if (line) yield line;
    }
  } catch {
    return;
  } finally {
    if (descriptor != null) {
      try {
        closeSync(descriptor);
      } catch {
        // Best effort only.
      }
    }
  }
}

function contextTokenCount(info: JsonObject | null): number {
  const last = objectField(info, "last_token_usage");
  const lastTotal = integerField(last, "total_tokens") ?? 0;
  if (lastTotal > 0) return lastTotal;
  return (
    integerField(objectField(info, "total_token_usage"), "total_tokens") ?? 0
  );
}

function usageWindow(
  value: JsonObject | null,
  percentKey: string,
): UsageWindow {
  if (!value) return EMPTY_WINDOW();
  return {
    usedPercent: numberField(value, percentKey),
    resetsAtEpoch: integerField(value, "resets_at"),
  };
}

function readCodexConfig(path: string): {
  model: string | null;
  effort: string | null;
} {
  try {
    const source = readFileSync(path, "utf8");
    return {
      model: tomlString(source, "model"),
      effort: tomlString(source, "model_reasoning_effort"),
    };
  } catch {
    return { model: null, effort: null };
  }
}

function tomlString(source: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`^\\s*${escapedKey}\\s*=\\s*["']([^"']+)["']`, "m").exec(
      source,
    )?.[1] ?? null
  );
}

function remember(path: string, entry: CachedSnapshot): void {
  touchCache(path, entry);
  while (snapshotCache.size > MAX_CACHE_ENTRIES) {
    const oldest = snapshotCache.keys().next().value;
    if (typeof oldest !== "string") break;
    snapshotCache.delete(oldest);
  }
}

function touchCache(path: string, entry: CachedSnapshot): void {
  snapshotCache.delete(path);
  snapshotCache.set(path, entry);
}

function fileStamp(path: string): string {
  try {
    const info = statSync(path);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return "missing";
  }
}

function readOptionalText(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

function readJsonObject(path: string): JsonObject | null {
  try {
    return asObject(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function objectField(value: JsonObject | null, key: string): JsonObject | null {
  return value ? asObject(value[key]) : null;
}

function stringField(value: JsonObject | null, key: string): string | null {
  const field = value?.[key];
  return typeof field === "string" ? field : null;
}

function numberField(value: JsonObject | null, key: string): number | null {
  const field = value?.[key];
  if (typeof field === "number" && Number.isFinite(field)) return field;
  if (typeof field === "string" && field.trim()) {
    const parsed = Number(field);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function integerField(value: JsonObject | null, key: string): number | null {
  const field = numberField(value, key);
  return field == null ? null : Math.trunc(field);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function directoryNames(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function fileNames(path: string, suffix: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Discovers only each WSL distro's configured default user's Codex root. */
export function detectWslCodexRoots(): string[] {
  if (process.platform !== "win32") return [];
  const roots: string[] = [];
  for (const distro of listWslDistros()) {
    const home = readWslDefaultHome(distro);
    const root = home ? wslHomeToCodexRoot(distro, home) : null;
    if (root && isDirectory(root)) roots.push(root);
  }
  return roots;
}

function readWslDefaultHome(distro: string): string | null {
  try {
    const result = execFileSync(
      "wsl.exe",
      ["-d", distro, "--", "sh", "-lc", 'printf "%s" "$HOME"'],
      { timeout: 5_000 },
    );
    return parseWslDefaultHome(result);
  } catch {
    return null;
  }
}

export function parseWslDefaultHome(output: Buffer | string): string | null {
  const text = decodeWslText(output)
    .replace(/^\uFEFF/, "")
    .replace(/\0/g, "")
    .replace(/\r?\n$/, "");
  if (
    !text.startsWith("/") ||
    text.includes("\\") ||
    /[\r\n\x00-\x1f\x7f]/.test(text)
  )
    return null;
  const segments = text.slice(1).split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  )
    return null;
  return `/${segments.join("/")}`;
}

export function wslHomeToCodexRoot(
  distro: string,
  home: string,
): string | null {
  if (!distro || /[\\/\r\n\x00-\x1f\x7f]/.test(distro)) return null;
  const validatedHome = parseWslDefaultHome(home);
  if (!validatedHome) return null;
  return `\\\\wsl.localhost\\${distro}\\${validatedHome.slice(1).replaceAll("/", "\\")}\\.codex`;
}

function listWslDistros(): string[] {
  try {
    return decodeWslText(
      execFileSync("wsl.exe", ["-l", "-q"], { timeout: 10_000 }),
    )
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/^\uFEFF/, "")
          .replace(/\0/g, "")
          .trim(),
      )
      .filter((line) => line.length > 0 && !/[\\/\x00-\x1f\x7f]/.test(line));
  } catch {
    return [];
  }
}

function decodeWslText(output: Buffer | string): string {
  if (typeof output === "string") return output;
  return output.includes(0)
    ? output.toString("utf16le")
    : output.toString("utf8");
}

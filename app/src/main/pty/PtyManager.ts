import * as pty from "node-pty";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { MessageChannelMain } from "electron";
import type { MessagePortMain, WebContents } from "electron";
import type { PtyCreateOptions } from "../../shared/ptyProtocol";
import { getProcessCwd } from "../processCwd";
import { buildShellSpawnArgs, type DiscoveredShell } from "../services/ShellDiscovery";

interface Session {
  proc: pty.IPty;
  port: MessagePortMain;
  /** The cwd this shell was actually spawned with — the fallback when a live PEB read fails or is stale. */
  resolvedCwd: string;
  /** `WebContents.id` of the renderer that owns this session, for lifecycle cleanup. */
  senderId: number;
  /** node-pty's onData/onExit registration handles — disposed in `kill()` so a just-killed session's proc can never fire either callback afterward (e.g. late buffered data racing a closed port). */
  disposables: pty.IDisposable[];
  /** Set at the start of `kill()`, before either teardown call — guards `onData` against posting to a port that's already being closed. */
  closed: boolean;
  /** Coalesced-but-not-yet-flushed output chunks (see the frame-batching in `create`). Concatenated on flush; dropped on `kill`. */
  pending: Buffer[];
  /** Running byte count of `pending`, so the high-water-mark check is O(1) per chunk instead of re-summing. */
  pendingBytes: number;
  /** Handle of the pending flush timer, or `null` when no flush is scheduled. Cleared on flush, exit, and kill. */
  flushTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Frame-batching cadence: shell output chunks are coalesced and flushed at
 * most once per this interval, so a burst of output costs one postMessage per
 * frame instead of one per pipe read. ~16ms tracks a 60Hz repaint.
 */
const FLUSH_INTERVAL_MS = 16;
/**
 * High-water mark: if buffered output reaches this many bytes before the timer
 * fires, flush immediately rather than let a firehose (e.g. `cat` of a big
 * file) grow an unbounded main-process buffer between frames.
 */
const FLUSH_WATERMARK_BYTES = 256 * 1024;

/**
 * Owns every live node-pty child process plus its dedicated output channel.
 * One MessageChannelMain per session: `port1` stays in main and receives
 * `proc.onData`, `port2` is transferred to the renderer once per session (see
 * `create`). Output is a UTF-8 text stream — node-pty hands us decoded
 * strings, which we re-encode to UTF-8 bytes and post as ArrayBuffers so
 * xterm's own streaming UTF-8 decoder sees raw bytes (never a re-decoded JS
 * string, which would mangle a multibyte char split across chunks). To keep a
 * burst of output from flooding the renderer with one postMessage per pipe
 * chunk, bytes are coalesced into frame-sized batches (see `FLUSH_INTERVAL_MS`
 * / `FLUSH_WATERMARK_BYTES`).
 */
export class PtyManager {
  private readonly sessions = new Map<string, Session>();
  /** WebContents ids we've already attached a destroyed/render-process-gone listener to. */
  private readonly watchedSenders = new Set<number>();

  /** Spawns a shell for `id` and hands the renderer its output port. Replaces any existing session for the same id. */
  create(id: string, options: PtyCreateOptions, sender: WebContents, shellProfile: DiscoveredShell): void {
    // The renderer that asked for this session may already be gone (dev
    // reload, crash between the IPC call and this handler running) — never
    // spawn a pty nobody can consume or close.
    if (sender.isDestroyed()) throw new Error("PTY renderer is already destroyed");
    if (!options || typeof options !== "object") throw new Error("Invalid PTY options");

    const cwd = resolveCwd(options.cwd);
    const cols = normalizeDimension(options.cols, 80);
    const rows = normalizeDimension(options.rows, 24);
    const args = buildShellSpawnArgs(shellProfile, options.startupCommand);

    if (!isValidSessionId(id)) throw new Error("Invalid PTY session id");

    // A renderer cannot replace another renderer's session merely by reusing
    // its id. This matters during reload/crash overlap, when two WebContents
    // can briefly coexist.
    const existing = this.sessions.get(id);
    if (existing && existing.senderId !== sender.id) {
      throw new Error("PTY session is owned by another renderer");
    }

    // Validate/resolve everything above before replacing a healthy session.
    if (existing) this.terminate(id);

    const proc = pty.spawn(shellProfile.command, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: process.env as { [key: string]: string },
    });

    let port1: MessagePortMain | undefined;
    try {
      const channel = new MessageChannelMain();
      port1 = channel.port1;
      port1.start();
      const mainPort = port1;

      // Declared before either node-pty callback is registered (not after, as
      // this used to be for `onData`) so both closures can reference the same
      // live `session` object by reference — `closed` gets flipped by `kill()`
      // and observed here even though these callbacks fire asynchronously,
      // possibly racing a kill/replace that already ran.
      const session: Session = {
        proc,
        port: mainPort,
        resolvedCwd: cwd,
        senderId: sender.id,
        disposables: [],
        closed: false,
        pending: [],
        pendingBytes: 0,
        flushTimer: null,
      };

      // Concatenates and posts everything buffered since the last flush. A no-op
      // if nothing is pending or the session has been torn down. `Buffer.concat`
      // returns a fresh, standalone buffer, so slicing its backing ArrayBuffer
      // never aliases Node's shared pool (the property the old per-chunk path
      // preserved by copying each small `Buffer.from` out).
      const flush = (): void => {
        if (session.flushTimer !== null) {
          clearTimeout(session.flushTimer);
          session.flushTimer = null;
        }
        if (session.pending.length === 0) return;
        const merged = Buffer.concat(session.pending, session.pendingBytes);
        session.pending = [];
        session.pendingBytes = 0;
        if (session.closed) return;
        const arrayBuffer = merged.buffer.slice(
          merged.byteOffset,
          merged.byteOffset + merged.byteLength,
        ) as ArrayBuffer;
        try {
          mainPort.postMessage(arrayBuffer);
        } catch {
          // Port already closed/destroyed racing this flush — nothing to deliver to.
        }
      };

      const dataDisposable = proc.onData((data: string) => {
        // A kill() may have already flipped `closed` and closed `port1` by the
        // time some already-buffered data drains through node-pty's pipe —
        // never buffer/post to a port we've torn down.
        if (session.closed) return;
        const buf = Buffer.from(data, "utf8");
        session.pending.push(buf);
        session.pendingBytes += buf.byteLength;
        // High-water mark: flush right now rather than let a firehose grow an
        // unbounded buffer between frames.
        if (session.pendingBytes >= FLUSH_WATERMARK_BYTES) {
          flush();
          return;
        }
        // Otherwise coalesce until the next frame tick.
        if (session.flushTimer === null) {
          session.flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
        }
      });

      const exitDisposable = proc.onExit(({ exitCode }) => {
        // If `id` was replaced (create() called again before this exit fired)
        // or already killed, `sessions.get(id)` no longer points at this
        // session object — never delete/close/report exit for a session that
        // is no longer live.
        if (this.sessions.get(id) !== session) return;
        this.sessions.delete(id);
        // Deliver any batched-but-unflushed output *before* closing the port and
        // sending `pty:exit`: exit travels a separate IPC channel from the data
        // port, so a still-buffered final frame would otherwise race behind the
        // renderer's "[process exited]" line.
        flush();
        session.closed = true;
        for (const disposable of session.disposables) {
          try {
            disposable.dispose();
          } catch {
            // A disposer throwing must not stop the rest of teardown.
          }
        }
        try {
          mainPort.close();
        } catch {
          // Already closing/closed — fine.
        }
        if (!sender.isDestroyed()) {
          try {
            sender.send("pty:exit", id, exitCode);
          } catch {
            // Renderer gone between the isDestroyed() check and send() — ignore.
          }
        }
      });

      session.disposables.push(dataDisposable, exitDisposable);
      this.sessions.set(id, session);
      this.watchSender(sender);

      if (sender.isDestroyed())
        throw new Error("PTY renderer was destroyed during creation");
      sender.postMessage("pty:port", id, [channel.port2]);
    } catch (error) {
      // Creation is transactional: an invoke resolves only after the PTY is
      // registered and its renderer port has been transferred. Any partial
      // failure tears down both native process and message channel.
      if (this.sessions.has(id)) {
        this.terminate(id);
      } else {
        try {
          port1?.close();
        } catch {
          // Best effort cleanup of a partially created channel.
        }
        try {
          proc.kill();
        } catch {
          // The process may already have exited.
        }
      }
      throw error;
    }
  }

  /**
   * Ties every session spawned for a given renderer to that renderer's
   * lifetime: if the WebContents is destroyed (window closed, dev reload) or
   * its process crashes, kill every pty/port still attributed to it rather
   * than leaking them with no consumer.
   */
  private watchSender(sender: WebContents): void {
    if (this.watchedSenders.has(sender.id)) return;
    this.watchedSenders.add(sender.id);
    const cleanup = (): void => this.killAllForSender(sender.id);
    sender.once("destroyed", cleanup);
    sender.once("render-process-gone", cleanup);
  }

  private killAllForSender(senderId: number): void {
    this.watchedSenders.delete(senderId);
    for (const [id, session] of this.sessions) {
      if (session.senderId === senderId) this.terminate(id);
    }
  }

  write(id: string, data: Uint8Array, senderId: number): void {
    const session = this.ownedSession(id, senderId);
    if (!session) return;
    try {
      session.proc.write(
        Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
          "utf8",
        ),
      );
    } catch {
      /* ignore write races against a just-exited process (same as resize()) */
    }
  }

  resize(id: string, cols: number, rows: number, senderId: number): void {
    const session = this.ownedSession(id, senderId);
    if (!session || cols <= 0 || rows <= 0) return;
    try {
      session.proc.resize(cols, rows);
    } catch {
      /* ignore resize races against a just-exited process */
    }
  }

  /**
   * Best-effort "current" cwd for `id`'s shell: a live PEB read of the shell
   * process, falling back to the cwd it was actually spawned with if the
   * read fails (process gone, unreadable live cwd, offsets don't apply). Note the
   * PEB read only reflects what the shell's own Win32 CurrentDirectory says,
   * which pwsh does not keep in sync with a plain `cd`/`Set-Location`
   * (parity §3 known issue #4) — this mirrors the WinUI original exactly.
   */
  getCwd(id: string, senderId: number): string | null {
    const session = this.ownedSession(id, senderId);
    if (!session) return null;
    return getProcessCwd(session.proc.pid) ?? session.resolvedCwd;
  }

  /** The shell process's own pid for `id` — the AI tool detector's process-tree BFS root. */
  getPid(id: string, senderId: number): number | null {
    return this.ownedSession(id, senderId)?.proc.pid ?? null;
  }

  kill(id: string, senderId: number): void {
    if (!this.ownedSession(id, senderId)) return;
    this.terminate(id);
  }

  private ownedSession(id: string, senderId: number): Session | null {
    const session = this.sessions.get(id);
    return session?.senderId === senderId ? session : null;
  }

  private terminate(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    // Mark closed and dispose the node-pty callbacks *before* touching the
    // port/process, so any data event that was already queued on the
    // microtask/event-loop queue sees `closed` and skips its postMessage
    // rather than racing the port.close() below.
    session.closed = true;
    // Drop any batched-but-unflushed output and cancel its pending flush — the
    // port is about to close (a kill/replace, not a natural exit), so there is
    // no consumer for it.
    if (session.flushTimer !== null) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    session.pending = [];
    session.pendingBytes = 0;
    for (const disposable of session.disposables) {
      try {
        disposable.dispose();
      } catch {
        // A disposer throwing must not stop the rest of teardown.
      }
    }
    try {
      session.port.close();
    } catch {
      // Port may already be closing/closed — fine.
    }
    try {
      session.proc.kill();
    } catch {
      // Process may already be gone (exited right before this call) — fine.
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) {
      try {
        this.terminate(id);
      } catch (err) {
        // One session's teardown throwing (shouldn't, given kill()'s own
        // internal guards, but defense in depth) must not stop the rest from
        // being torn down — this runs from before-quit.
        console.error(`[PtyManager] kill(${id}) failed during killAll`, err);
      }
    }
  }
}

function isValidSessionId(id: string): boolean {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(id)
  );
}

function resolveCwd(cwd?: string): string {
  if (cwd && existsSync(cwd) && statSync(cwd).isDirectory()) return cwd;
  return homedir();
}

/** Finite positive integer or fall back — guards against negative/NaN/Infinity dimensions from IPC. */
function normalizeDimension(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

import type { Socket } from "node:net";
import { Worker } from "node:worker_threads";
import { getRelayPipeName } from "./conoutRelayProtocol";
import type { ConoutRelayReply, ConoutRelayRequest } from "./conoutRelayProtocol";

/** node-pty's own value (`windowsConoutConnection.js`): how long to keep draining after the shell exits. */
const FLUSH_DATA_INTERVAL = 1000;

/**
 * Hosts the single worker thread that drains every tab's conout pipe. node-pty
 * 1.1.0 spawns one Worker per PTY for this; on Windows each costs ~6 MB private
 * working set. The worker is started with the first tab and terminated when the
 * last one closes.
 */
export class ConoutRelayHost {
  private worker: Worker | null = null;
  private readonly ready = new Map<string, () => void>();
  private readonly open = new Set<string>();

  constructor(private readonly scriptPath: string) {}

  attach(conoutPipeName: string, onReady: () => void): void {
    this.ready.set(conoutPipeName, onReady);
    this.open.add(conoutPipeName);
    this.ensureWorker().postMessage({ type: "open", conoutPipeName } satisfies ConoutRelayRequest);
  }

  detach(conoutPipeName: string): void {
    this.ready.delete(conoutPipeName);
    if (!this.open.delete(conoutPipeName) || !this.worker) return;
    this.worker.postMessage({ type: "close", conoutPipeName } satisfies ConoutRelayRequest);
    if (this.open.size === 0) {
      const worker = this.worker;
      this.worker = null;
      void worker.terminate();
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.scriptPath);
    worker.on("message", (message: ConoutRelayReply) => {
      if (message.type === "ready") this.ready.get(message.conoutPipeName)?.();
    });
    worker.on("error", (err) => console.error("[conout-relay]", err));
    // An unexpected exit takes every pipe it owned with it (ConPTY's conout pipe
    // cannot be reconnected). Forget them so they cannot pin the next worker open;
    // their tabs end the way a tab whose private worker died would.
    worker.on("exit", (code) => {
      if (this.worker !== worker) return;
      this.worker = null;
      console.error(`[conout-relay] worker exited unexpectedly (code ${code}); ${this.open.size} pty pipe(s) lost`);
      this.open.clear();
      this.ready.clear();
    });
    this.worker = worker;
    return worker;
  }
}

/**
 * Drop-in for node-pty's `ConoutConnection` (same constructor, `onReady`,
 * `connectSocket`, `dispose` and drain delay) that relays through the shared
 * worker instead of a private one.
 */
export function createSharedConoutConnection(host: ConoutRelayHost) {
  return class SharedConoutConnection {
    private isDisposed = false;
    private drainTimeout: NodeJS.Timeout | undefined;
    private readonly listeners = new Set<() => void>();

    constructor(
      private readonly conoutPipeName: string,
      private readonly useConptyDll: boolean,
    ) {
      host.attach(conoutPipeName, () => this.listeners.forEach((listener) => listener()));
    }

    get onReady(): (listener: () => void) => { dispose(): void } {
      return (listener) => {
        this.listeners.add(listener);
        return { dispose: () => void this.listeners.delete(listener) };
      };
    }

    dispose(): void {
      if (!this.useConptyDll && this.isDisposed) return;
      this.isDisposed = true;
      // Drain all data from the socket before closing.
      if (this.drainTimeout) clearTimeout(this.drainTimeout);
      this.drainTimeout = setTimeout(() => host.detach(this.conoutPipeName), FLUSH_DATA_INTERVAL);
    }

    connectSocket(socket: Socket): void {
      socket.connect(getRelayPipeName(this.conoutPipeName));
      // node-pty only disposes on kill(); a shell that exits by itself closes the
      // socket and is never killed, so release the relay when the consumer is gone.
      socket.once("close", () => this.dispose());
    }
  };
}

interface ConoutModule {
  ConoutConnection?: unknown;
}

/**
 * Points node-pty's Windows agent at the shared worker by swapping the
 * `ConoutConnection` export it reads on every spawn. Refuses (leaving node-pty
 * untouched, one worker per PTY) if the module is not the shape this was
 * written against, so a node-pty upgrade degrades instead of breaking spawns.
 */
export function installSharedConout(
  mod: ConoutModule,
  scriptPath: string,
): { installed: boolean; host?: ConoutRelayHost } {
  const original = mod.ConoutConnection as { prototype?: Record<string, unknown> } | undefined;
  const proto = original?.prototype;
  const looksRight =
    typeof original === "function" &&
    !!proto &&
    typeof proto.connectSocket === "function" &&
    typeof proto.dispose === "function" &&
    "onReady" in proto;
  if (!looksRight) return { installed: false };
  const host = new ConoutRelayHost(scriptPath);
  mod.ConoutConnection = createSharedConoutConnection(host);
  return { installed: true, host };
}

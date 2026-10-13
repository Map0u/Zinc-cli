import { createServer, Socket } from "node:net";
import type { Server } from "node:net";
import { parentPort } from "node:worker_threads";
import { getRelayPipeName } from "./conoutRelayProtocol";
import type { ConoutRelayReply, ConoutRelayRequest } from "./conoutRelayProtocol";

/**
 * One worker thread that drains every tab's ConPTY conout pipe, replacing the
 * thread node-pty spawns per PTY (~6 MB each). It does exactly what node-pty's
 * `worker/conoutSocketWorker.js` does for one pipe: connect to the conout pipe,
 * then re-serve it on `<pipe>-worker` for the main thread. The point of doing
 * it off the main thread is unchanged — ConPTY blocks `ClosePseudoConsole`
 * until conout is drained (node-pty#375), and the main thread is the one
 * calling it — so nothing here may ever wait on the main thread.
 */
interface Relay {
  conout: Socket;
  server: Server;
  clients: Set<Socket>;
}

const relays = new Map<string, Relay>();

// One tab's broken pipe must never take the other tabs' drain down with it.
process.on("uncaughtException", (err) => console.error("[conout-relay]", err));

function open(conoutPipeName: string): void {
  if (relays.has(conoutPipeName)) return;
  const conout = new Socket();
  conout.setEncoding("utf8");
  const clients = new Set<Socket>();
  const server = createServer((client) => {
    clients.add(client);
    client.on("close", () => clients.delete(client));
    client.on("error", () => client.destroy());
    conout.pipe(client);
  });
  const relay: Relay = { conout, server, clients };
  relays.set(conoutPipeName, relay);
  conout.on("error", () => close(conoutPipeName));
  server.on("error", () => close(conoutPipeName));
  conout.connect(conoutPipeName, () => {
    server.listen(getRelayPipeName(conoutPipeName));
    parentPort?.postMessage({ type: "ready", conoutPipeName } satisfies ConoutRelayReply);
  });
}

function close(conoutPipeName: string): void {
  const relay = relays.get(conoutPipeName);
  if (!relay) return;
  relays.delete(conoutPipeName);
  relay.conout.destroy();
  for (const client of relay.clients) client.destroy();
  relay.server.close();
}

parentPort?.on("message", (message: ConoutRelayRequest) => {
  if (message.type === "open") open(message.conoutPipeName);
  else if (message.type === "close") close(message.conoutPipeName);
});

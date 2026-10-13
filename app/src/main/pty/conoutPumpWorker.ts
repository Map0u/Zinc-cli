import { createServer, Socket } from "node:net";
import type { Server } from "node:net";
import { parentPort } from "node:worker_threads";
import { getPumpPipeName } from "./conoutPumpProtocol";
import type { ConoutPumpReply, ConoutPumpRequest } from "./conoutPumpProtocol";

/**
 * One worker thread that drains every tab's ConPTY conout pipe, replacing the
 * thread node-pty spawns per PTY (~6 MB each). It does exactly what node-pty's
 * `worker/conoutSocketWorker.js` does for one pipe: connect to the conout pipe,
 * then re-serve it on `<pipe>-worker` for the main thread. The point of doing
 * it off the main thread is unchanged — ConPTY blocks `ClosePseudoConsole`
 * until conout is drained (node-pty#375), and the main thread is the one
 * calling it — so nothing here may ever wait on the main thread.
 */
interface Pump {
  conout: Socket;
  server: Server;
  clients: Set<Socket>;
}

const pumps = new Map<string, Pump>();

// One tab's broken pipe must never take the other tabs' drain down with it.
process.on("uncaughtException", (err) => console.error("[conout-pump]", err));

function open(conoutPipeName: string): void {
  if (pumps.has(conoutPipeName)) return;
  const conout = new Socket();
  conout.setEncoding("utf8");
  const clients = new Set<Socket>();
  const server = createServer((client) => {
    clients.add(client);
    client.on("close", () => clients.delete(client));
    client.on("error", () => client.destroy());
    conout.pipe(client);
  });
  const pump: Pump = { conout, server, clients };
  pumps.set(conoutPipeName, pump);
  conout.on("error", () => close(conoutPipeName));
  server.on("error", () => close(conoutPipeName));
  conout.connect(conoutPipeName, () => {
    server.listen(getPumpPipeName(conoutPipeName));
    parentPort?.postMessage({ type: "ready", conoutPipeName } satisfies ConoutPumpReply);
  });
}

function close(conoutPipeName: string): void {
  const pump = pumps.get(conoutPipeName);
  if (!pump) return;
  pumps.delete(conoutPipeName);
  pump.conout.destroy();
  for (const client of pump.clients) client.destroy();
  pump.server.close();
}

parentPort?.on("message", (message: ConoutPumpRequest) => {
  if (message.type === "open") open(message.conoutPipeName);
  else if (message.type === "close") close(message.conoutPipeName);
});

/** Messages between the main process and the shared conout pump worker (see `conoutPumpWorker.ts`). */
export type ConoutPumpRequest =
  | { type: "open"; conoutPipeName: string }
  | { type: "close"; conoutPipeName: string };

export type ConoutPumpReply = { type: "ready"; conoutPipeName: string };

/** Same name node-pty derives in `lib/shared/conout.js`; its agent connects the tab's out socket here. */
export function getPumpPipeName(conoutPipeName: string): string {
  return `${conoutPipeName}-worker`;
}

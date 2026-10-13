/** Messages between the main process and the shared conout relay worker (see `conoutRelayWorker.ts`). */
export type ConoutRelayRequest =
  | { type: "open"; conoutPipeName: string }
  | { type: "close"; conoutPipeName: string };

export type ConoutRelayReply = { type: "ready"; conoutPipeName: string };

/** Same name node-pty derives in `lib/shared/conout.js`; its agent connects the tab's out socket here. */
export function getRelayPipeName(conoutPipeName: string): string {
  return `${conoutPipeName}-worker`;
}

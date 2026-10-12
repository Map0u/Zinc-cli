import { rewriteSgrParamsForTransparentBg } from './transparentTerminalBackground'

/**
 * Applies the transparent-background SGR rewrite (see
 * transparentTerminalBackground.ts) to the raw pty byte stream *before* it
 * reaches xterm, instead of from inside an xterm CSI handler.
 *
 * The old parser-hook version swallowed the SGR and re-injected the rewritten
 * one with `term.write()`, which queues it *behind* everything already
 * buffered — text after the SGR could be parsed with the old attributes, so
 * colors depended on how the output happened to be chunked. It also cost a
 * second parse pass per rewritten sequence. Rewriting in-stream keeps every
 * byte in its original order and lets xterm parse each sequence once.
 *
 * A tiny VT state machine tracks only what matters for that: ground text,
 * CSI sequences (held until their final byte so a sequence split across two
 * chunks is still seen whole), and OSC/DCS/SOS/PM/APC strings (skipped so an
 * SGR-looking payload inside them is never touched). Anything unexpected falls
 * back to passing the bytes through unchanged, which is always safe.
 */

const ESC = 0x1b
const BEL = 0x07
const CAN = 0x18
const SUB = 0x1a
const LBRACKET = 0x5b
const BACKSLASH = 0x5c
const FINAL_M = 0x6d
/** Longest CSI we bother holding; real SGRs are far shorter. */
const MAX_HELD = 512

const enum State {
  Ground,
  Esc,
  Csi,
  Str,
  StrEsc
}

function isStringIntroducer(byte: number): boolean {
  // ESC ] (OSC), ESC P (DCS), ESC X (SOS), ESC ^ (PM), ESC _ (APC)
  return byte === 0x5d || byte === 0x50 || byte === 0x58 || byte === 0x5e || byte === 0x5f
}

const encoder = new TextEncoder()

/** Parses an SGR parameter string (`1;48;2;0;0;0` / `48:2:0:0:0`) into xterm's public params shape. */
export function parseSgrParams(text: string): (number | number[])[] {
  if (text.length === 0) return [0]
  return text.split(';').map((field) => {
    if (!field.includes(':')) return field === '' ? 0 : Number(field)
    const [head, ...subs] = field.split(':')
    return [head === '' ? 0 : Number(head), ...subs.map((s) => (s === '' ? -1 : Number(s)))]
  }).flatMap((p) => (Array.isArray(p) ? [p[0], p.slice(1)] : [p]))
}

/**
 * Serializes params back to SGR text, keeping colon subparameters attached to
 * their parameter (`4:3` stays curly underline instead of becoming `4;3`).
 */
export function formatSgrParamsPreservingSubparams(params: ReadonlyArray<number | number[]>): string {
  const tokens: string[] = []
  for (const p of params) {
    if (Array.isArray(p)) {
      const subs = p.map((v) => (v < 0 ? '' : String(v))).join(':')
      if (tokens.length > 0) tokens[tokens.length - 1] += `:${subs}`
      else tokens.push(subs)
    } else {
      tokens.push(String(p))
    }
  }
  return tokens.join(';')
}

export class TransparentSgrStream {
  private state: State = State.Ground
  /** Bytes of a pending ESC / CSI that has not reached its final byte yet. */
  private held: number[] = []

  /** Drops any parse state and returns bytes that were still held back. */
  reset(): Uint8Array {
    const pending = Uint8Array.from(this.held)
    this.held = []
    this.state = State.Ground
    return pending
  }

  /** Returns the bytes to hand xterm for `data`, in order (may hold a trailing partial CSI). */
  push(data: Uint8Array): Uint8Array {
    const out: Uint8Array[] = []
    const n = data.length
    // Start of the current pass-through run in `data`; -1 while holding.
    let runStart = this.state === State.Esc || this.state === State.Csi ? -1 : 0
    const flushRun = (end: number): void => {
      if (runStart >= 0 && end > runStart) out.push(data.subarray(runStart, end))
      runStart = -1
    }
    const releaseHeld = (): void => {
      if (this.held.length > 0) out.push(Uint8Array.from(this.held))
      this.held = []
    }

    let i = 0
    while (i < n) {
      switch (this.state) {
        case State.Ground: {
          const j = data.indexOf(ESC, i)
          if (j < 0) {
            i = n
            break
          }
          flushRun(j)
          this.held = [ESC]
          this.state = State.Esc
          i = j + 1
          break
        }
        case State.Esc: {
          const b = data[i]
          if (b === LBRACKET) {
            this.held.push(b)
            this.state = State.Csi
            i++
            break
          }
          releaseHeld()
          runStart = i
          if (isStringIntroducer(b)) {
            this.state = State.Str
            i++
          } else {
            // Any other escape passes through untouched; a second ESC is
            // re-examined from ground so it can start its own sequence.
            this.state = State.Ground
            if (b !== ESC) i++
          }
          break
        }
        case State.Csi: {
          const b = data[i]
          if (b >= 0x20 && b <= 0x3f) {
            this.held.push(b)
            i++
            if (this.held.length > MAX_HELD) {
              releaseHeld()
              runStart = i
              this.state = State.Ground
            }
          } else if (b >= 0x40 && b <= 0x7e) {
            this.held.push(b)
            out.push(this.finishCsi())
            this.held = []
            i++
            runStart = i
            this.state = State.Ground
          } else {
            // C0 control / ESC / CAN inside the CSI: stop interpreting and
            // pass the original bytes on; xterm handles them identically.
            releaseHeld()
            runStart = i
            this.state = State.Ground
          }
          break
        }
        case State.Str: {
          let j = i
          while (j < n) {
            const b = data[j]
            if (b === BEL || b === ESC || b === CAN || b === SUB) break
            j++
          }
          if (j >= n) {
            i = n
            break
          }
          const b = data[j]
          i = j + 1
          this.state = b === ESC ? State.StrEsc : State.Ground
          break
        }
        case State.StrEsc: {
          const b = data[i]
          if (b === BACKSLASH) {
            this.state = State.Ground
            i++
            break
          }
          // ESC that is not ST aborts the string and starts a new escape.
          // When that ESC is still in this chunk, hold it so a following CSI
          // can be rewritten; otherwise just resume from ground.
          if (i > 0 && data[i - 1] === ESC && runStart >= 0) {
            flushRun(i - 1)
            this.held = [ESC]
            this.state = State.Esc
          } else {
            this.state = State.Ground
          }
          break
        }
      }
    }
    if (this.state !== State.Esc && this.state !== State.Csi) flushRun(n)

    if (out.length === 0) return new Uint8Array(0)
    if (out.length === 1) return out[0]
    let total = 0
    for (const part of out) total += part.length
    const merged = new Uint8Array(total)
    let offset = 0
    for (const part of out) {
      merged.set(part, offset)
      offset += part.length
    }
    return merged
  }

  private finishCsi(): Uint8Array {
    const held = this.held
    const raw = Uint8Array.from(held)
    if (held[held.length - 1] !== FINAL_M) return raw
    // Only plain SGR: digits, ';' and ':' — no private prefix, no intermediates.
    let text = ''
    for (let k = 2; k < held.length - 1; k++) {
      const b = held[k]
      if ((b < 0x30 || b > 0x39) && b !== 0x3b && b !== 0x3a) return raw
      text += String.fromCharCode(b)
    }
    const rewritten = rewriteSgrParamsForTransparentBg(parseSgrParams(text))
    if (!rewritten) return raw
    return encoder.encode(`\x1b[${formatSgrParamsPreservingSubparams(rewritten)}m`)
  }
}

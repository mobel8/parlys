// Renderer-side MP3 streaming player for the interpreter.
//
// The main process pushes base64-encoded MP3 chunks as they arrive
// from the TTS provider. We assemble them into a MediaSource-backed
// <audio> element so playback starts at the FIRST chunk — no waiting
// for the full utterance.
//
// Why MediaSource and not repeated Audio+URL.createObjectURL?
//   Repeated blob-url swaps restart playback at 0 and cause audible
//   gaps. MediaSource appends bytes to the same SourceBuffer so the
//   decoder sees an uninterrupted MP3 stream.
//
// Fallback path: if `MediaSource.isTypeSupported('audio/mpeg')` is
// false (rare; Chromium Linux builds without the MP3 codec), we fall
// back to a simple blob-url mode that plays only once all chunks are
// in — still functional, just latency-heavier.

import type { InterpretChunkEvent } from '../../shared/types';

export interface InterpretPlayerEvents {
  onFirstChunk?: (ttfbClientMs: number) => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

export interface InterpretPlayerOptions {
  /**
   * Optional audio output device id (as returned by
   * `navigator.mediaDevices.enumerateDevices()`). When set, playback
   * is routed to that device via `HTMLAudioElement.setSinkId()`. This
   * is how we push the translated voice to a virtual microphone
   * (VB-Cable, VoiceMeeter) for Discord / Zoom / Meet.
   *
   * Empty string or undefined = use the system default output.
   */
  sinkId?: string;

  /**
   * When `true` (default), playback begins the moment the first chunk
   * lands in the SourceBuffer — "speak as soon as we can". Useful for
   * one-shot dictation where no serialization is needed.
   *
   * When `false`, incoming chunks are buffered but playback is held
   * until `start()` is called. This is how the continuous interpreter
   * enforces strict FIFO playback: player N+1 keeps buffering while
   * player N finishes, then the hook calls `start()` on N+1 so the
   * user never hears two phrases overlap.
   */
  autoStart?: boolean;
}

export class InterpretPlayer {
  private readonly requestId: string;
  private readonly audio: HTMLAudioElement;
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private readonly pendingChunks: Uint8Array[] = [];
  private firstChunkAt = 0;
  private startAt = 0;
  private ended = false;
  private disposed = false;
  private readonly events: InterpretPlayerEvents;
  /** Fallback mode: accumulate into a single Blob, play at end. */
  private readonly fallbackBytes: Uint8Array[] = [];
  private useFallback = false;

  /** Whether playback has been authorized (auto-start or explicit `start()`). */
  private started: boolean;

  constructor(requestId: string, events: InterpretPlayerEvents = {}, options: InterpretPlayerOptions = {}) {
    this.requestId = requestId;
    this.events = events;
    this.started = options.autoStart !== false;
    this.audio = new Audio();
    // autoplay mirrors `started` — when the hook holds us in a queue
    // (autoStart=false), the <audio> element stays paused even once
    // the SourceBuffer has bytes, so `chunks-in / playback-out` stay
    // decoupled.
    this.audio.autoplay = this.started;
    this.audio.preload = 'auto';
    this.audio.onerror = () => {
      // Media decoding error — surface as a player error but do not
      // retry here (the chunk protocol is one-shot).
      const err = this.audio.error;
      const code = err?.code ?? -1;
      this.events.onError?.(new Error(`Audio element error (code ${code})`));
    };
    this.audio.onended = () => {
      this.events.onEnd?.();
    };

    // Output device routing (virtual mic, secondary speakers, etc).
    // setSinkId is only available in Chromium-based engines — Electron
    // qualifies. Errors are non-fatal: we just fall back to the default
    // device rather than blocking playback.
    if (options.sinkId) {
      const a = this.audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (typeof a.setSinkId === 'function') {
        a.setSinkId(options.sinkId).catch((err) => {
          console.warn('[interpret-player] setSinkId failed:', err?.message || err);
        });
      }
    }

    const MIME = 'audio/mpeg';
    if (typeof window !== 'undefined'
        && 'MediaSource' in window
        && (window as any).MediaSource.isTypeSupported?.(MIME)) {
      this.mediaSource = new MediaSource();
      this.audio.src = URL.createObjectURL(this.mediaSource);
      this.mediaSource.addEventListener('sourceopen', () => {
        try {
          const sb = this.mediaSource!.addSourceBuffer(MIME);
          sb.mode = 'sequence';
          sb.addEventListener('updateend', () => this.flushPending());
          this.sourceBuffer = sb;
          this.flushPending();
        } catch (err: any) {
          // Some platforms refuse to add an MP3 SourceBuffer even when
          // isTypeSupported returns true — fall back to Blob playback.
          this.useFallback = true;
          this.events.onError?.(new Error(`addSourceBuffer failed: ${err?.message || err}`));
        }
      });
    } else {
      this.useFallback = true;
    }
    this.startAt = Date.now();
  }

  /** Feed an inbound IPC chunk. Silently ignores chunks for other requestIds. */
  push(evt: InterpretChunkEvent): void {
    if (this.disposed) return;
    if (evt.requestId !== this.requestId) return;
    if (evt.error) {
      this.events.onError?.(new Error(evt.error));
      this.dispose();
      return;
    }

    if (evt.chunkBase64) {
      if (this.firstChunkAt === 0) {
        this.firstChunkAt = Date.now();
        this.events.onFirstChunk?.(this.firstChunkAt - this.startAt);
      }
      const bytes = base64ToUint8Array(evt.chunkBase64);
      if (this.useFallback) {
        this.fallbackBytes.push(bytes);
      } else {
        this.pendingChunks.push(bytes);
        this.flushPending();
      }
    }

    if (evt.done) {
      if (this.useFallback) {
        // Build a final blob URL and play.
        try {
          const blob = new Blob(this.fallbackBytes as BlobPart[], { type: 'audio/mpeg' });
          this.audio.src = URL.createObjectURL(blob);
          this.audio.play().catch((err) => {
            this.events.onError?.(new Error(`Fallback play failed: ${err?.message || err}`));
          });
        } catch (err: any) {
          this.events.onError?.(new Error(`Fallback assembly failed: ${err?.message || err}`));
        }
      } else if (this.mediaSource && this.mediaSource.readyState === 'open') {
        // Defer endOfStream() until any pending append flushes.
        const finish = () => {
          try {
            if (this.mediaSource && this.mediaSource.readyState === 'open') {
              this.mediaSource.endOfStream();
            }
          } catch { /* ignore — some browsers throw if already closed */ }
        };
        if (this.sourceBuffer && this.sourceBuffer.updating) {
          this.sourceBuffer.addEventListener('updateend', finish, { once: true });
        } else {
          finish();
        }
      }
      this.ended = true;
    }
  }

  /** True once every chunk has been consumed and sent to the audio element. */
  isEnded(): boolean {
    return this.ended;
  }

  /**
   * Authorize playback. No-op if the player was created with
   * autoStart=true (default) or if `start()` has already been called.
   *
   * Safe to call before ANY chunks arrive: we flip `autoplay = true`
   * so the element will play as soon as the SourceBuffer is seeded.
   * Also safe to call AFTER chunks have arrived but playback was held:
   * we call `audio.play()` explicitly, which returns a promise the
   * caller can await to know when audio actually starts.
   *
   * Returns a promise that resolves when playback starts (or is
   * already running). Rejects if the browser blocks playback.
   */
  start(): Promise<void> {
    if (this.started) {
      // Already playing (or ended) — just return a resolved promise so
      // callers can await unconditionally.
      return Promise.resolve();
    }
    this.started = true;
    this.audio.autoplay = true;
    // If the SourceBuffer (or fallback blob) is ready, `.play()`
    // actually begins playback. If not yet, autoplay=true will kick
    // it in when the first data lands.
    const p = this.audio.play();
    return p instanceof Promise ? p.catch(() => { /* blocked → onerror handles surfacing */ }) : Promise.resolve();
  }

  /** True if the player has been authorized to play. */
  hasStarted(): boolean {
    return this.started;
  }

  /** Tear down the player, stopping playback and releasing resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    } catch { /* ignore */ }
    try {
      if (this.mediaSource && this.mediaSource.readyState === 'open') {
        this.mediaSource.endOfStream();
      }
    } catch { /* ignore */ }
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.pendingChunks.length = 0;
    this.fallbackBytes.length = 0;
  }

  private flushPending(): void {
    const sb = this.sourceBuffer;
    if (!sb || sb.updating || this.pendingChunks.length === 0) return;
    const next = this.pendingChunks.shift()!;
    try {
      // Pass an ArrayBuffer explicitly (not the Uint8Array view) to
      // dodge a strict-TS incompatibility between Uint8Array<ArrayBufferLike>
      // and SourceBuffer.appendBuffer(BufferSource).
      sb.appendBuffer(next.buffer.slice(next.byteOffset, next.byteOffset + next.byteLength) as ArrayBuffer);
    } catch (err: any) {
      // QuotaExceededError if the buffer is saturated — for short
      // utterances this shouldn't happen, but put the chunk back and
      // retry on the next updateend tick.
      this.pendingChunks.unshift(next);
      if (err?.name !== 'QuotaExceededError') {
        this.events.onError?.(new Error(`appendBuffer failed: ${err?.message || err}`));
      }
    }
  }
}

function base64ToUint8Array(b64: string): Uint8Array {
  // atob is available in renderer (Electron = Chromium). The main
  // process sends us pure base64 (no data-URL prefix).
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Strict FIFO queue of `InterpretPlayer`s that guarantees playback is
 * **serial** — only one player speaks at a time. Every other player
 * keeps ingesting MP3 chunks into its own buffer (so translation
 * latency overlaps with speech of earlier phrases) but stays silent
 * until its turn comes.
 *
 * Used by:
 *   - `useContinuousInterpreter` (VAD-driven, one phrase = one player)
 *   - `ListenerPanel` (one incoming segment = one player)
 *
 * The whole idea is that the user hears A → B → C as three consecutive
 * utterances, never as "A + B mumbled over each other". Translations
 * that happen to finish out-of-order simply wait their slot.
 */
export class InterpretPlayerQueue {
  private readonly queue: InterpretPlayer[] = [];
  private readonly onErrorHook?: (err: Error) => void;

  constructor(onError?: (err: Error) => void) {
    this.onErrorHook = onError;
  }

  /**
   * Enqueue a player. If it lands at the head (queue was empty), it
   * starts playing immediately. Otherwise it waits for the preceding
   * player to emit `onEnd` / `onError` before `advance()` promotes it.
   *
   * The player MUST be constructed with `autoStart: false` so the
   * queue can control the start time.
   */
  add(player: InterpretPlayer): void {
    this.queue.push(player);
    if (this.queue.length === 1) {
      player.start().catch((err) => this.onErrorHook?.(err));
    }
  }

  /**
   * Mark a player as terminated (naturally ended, errored, or
   * externally disposed) and promote the next queued player if we
   * just removed the head. Idempotent — extra calls are no-ops.
   */
  advance(player: InterpretPlayer): void {
    const wasHead = this.queue[0] === player;
    const i = this.queue.indexOf(player);
    if (i >= 0) this.queue.splice(i, 1);
    if (wasHead) {
      const next = this.queue[0];
      if (next && !next.hasStarted()) {
        next.start().catch((err) => this.onErrorHook?.(err));
      }
    }
  }

  /**
   * Route an incoming IPC chunk to the matching player. Chunks whose
   * requestId doesn't match any player are dropped silently (handled
   * by `InterpretPlayer.push` guard).
   *
   * We iterate the whole queue because iterating by Map-of-requestId
   * is micro-optimized but not worth the complexity for the <10
   * active players the queue ever holds.
   */
  route(evt: InterpretChunkEvent): void {
    for (const p of this.queue) p.push(evt);
  }

  /** Tear everything down. Safe to call repeatedly. */
  disposeAll(): void {
    for (const p of this.queue) p.dispose();
    this.queue.length = 0;
  }

  /** Diagnostic — how many players are currently buffered. */
  size(): number {
    return this.queue.length;
  }
}

/**
 * Abort/timeout helper for external network calls (STT / translate / TTS).
 *
 * Every external fetch in the audio pipelines used to run with NO deadline:
 * a stalled upstream (Groq / Cartesia hanging the socket open without
 * sending bytes) would hang the IPC handler forever, and for the streaming
 * handlers the renderer's MediaSource never received its done-sentinel and
 * leaked buffers. This helper produces an AbortSignal that fires after
 * `timeoutMs`, optionally chained to an `external` signal (used to abort a
 * still-streaming utterance when a newer one supersedes it).
 *
 * Deliberately PURE — no electron import — so it can be unit-tested
 * standalone against the compiled dist/main/services/abort.js.
 */

export interface AbortableSignal {
  /** Pass this into fetch(..., { signal }). */
  signal: AbortSignal;
  /** Lets the caller cancel manually with a custom reason (e.g. 'superseded'). */
  controller: AbortController;
  /** Clears the timer and removes the external listener. Idempotent. */
  dispose: () => void;
}

/**
 * Create an AbortController whose signal aborts:
 *   - automatically after `timeoutMs` (reason = Error/DOMException named
 *     'TimeoutError'), and/or
 *   - when the optional `external` signal aborts (its reason is forwarded), and/or
 *   - when the caller invokes `controller.abort(reason)` directly.
 *
 * The timer is `unref`'d so it never keeps the Node/Electron event loop
 * alive on its own. `dispose()` is safe to call any number of times.
 */
export function abortableSignal(
  timeoutMs: number,
  external?: AbortSignal,
): AbortableSignal {
  const controller = new AbortController();

  // Fire a TimeoutError after timeoutMs. We construct a DOMException when the
  // runtime provides it (Node 18+/Electron do) so `reason.name === 'TimeoutError'`
  // matches the platform AbortSignal.timeout() convention; otherwise fall back
  // to a plain Error carrying the same name.
  const makeTimeoutReason = (): unknown => {
    try {
      return new DOMException('Operation timed out', 'TimeoutError');
    } catch {
      const e = new Error('Operation timed out');
      e.name = 'TimeoutError';
      return e;
    }
  };

  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    // Guard: abort() is a no-op once already aborted, but we still null the
    // timer ref so dispose() stays cheap.
    timer = null;
    if (!controller.signal.aborted) controller.abort(makeTimeoutReason());
  }, timeoutMs);
  // Don't let a pending deadline keep the process alive. unref isn't present
  // on every timer impl (browsers), hence the guard — keeps the helper pure.
  if (typeof (timer as any)?.unref === 'function') (timer as any).unref();

  // Forward an external abort (e.g. the previous utterance being superseded)
  // to our controller, preserving the original reason so callers can branch
  // on it ('superseded' vs a timeout).
  let onExternalAbort: (() => void) | null = null;
  if (external) {
    if (external.aborted) {
      // Already aborted before we even armed — abort promptly with its reason.
      if (!controller.signal.aborted) controller.abort((external as any).reason);
    } else {
      onExternalAbort = () => {
        if (!controller.signal.aborted) controller.abort((external as any).reason);
      };
      external.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const dispose = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (external && onExternalAbort) {
      try { external.removeEventListener('abort', onExternalAbort); } catch { /* ignore */ }
      onExternalAbort = null;
    }
  };

  return { signal: controller.signal, controller, dispose };
}

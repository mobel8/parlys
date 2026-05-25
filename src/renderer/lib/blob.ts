/**
 * Tiny blob utilities shared by the audio pipeline.
 *
 * All these live in the renderer — the main process reads the base64
 * payload via the `interpret` / `listenerTranscribe` IPC and decodes
 * it itself with `Buffer.from(..., 'base64')`.
 */

/**
 * Convert a Blob to a pure base64 string (no `data:` prefix).
 *
 * Uses `FileReader.readAsDataURL` rather than `arrayBuffer` +
 * `btoa(String.fromCharCode(...))` because the latter is limited to
 * 64 KB strings on Chromium due to the call-stack hard cap — our
 * audio blobs can easily hit 200-500 KB on a single utterance.
 *
 * Resolves with the string part AFTER the first comma, so the result
 * is safe to pass straight to the IPC which expects pure base64.
 * Rejects on underlying FileReader errors (very rare — out-of-memory
 * or permission revoked).
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

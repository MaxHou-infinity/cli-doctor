/**
 * Clipboard access for the report copy actions (CONTRACT.md §v2.8).
 *
 * The panel must never crash (and must never inject DOM or global styles) just
 * because the clipboard API is missing or denied. This module therefore:
 *
 * - takes the clipboard implementation as an injectable seam (`options.clipboard`,
 *   defaulting to `navigator.clipboard`) so the unavailable/failed paths are
 *   unit-testable;
 * - never throws — it resolves to `{ok, reason}`;
 * - performs no DOM or network work at all.
 *
 * The panel turns a failure into an in-place read-only `<textarea>` fallback
 * rendered with React and inline styles.
 *
 * @module dsh-cli-doctor/client/clipboard
 */

/** How long the "已复制" feedback stays visible (milliseconds). */
export const COPY_FEEDBACK_MS = 2000;

/** Readable reason shown when the clipboard is not usable at all. */
export const CLIPBOARD_UNAVAILABLE_TEXT = '当前环境不支持剪贴板写入，请在下方文本框手动复制。';

/** Readable reason shown when the clipboard API failed. */
export const CLIPBOARD_FAILED_TEXT = '剪贴板写入失败，请在下方文本框手动复制。';

/** Short readable form of an arbitrary thrown value. */
function errorText(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return String(error);
}

/** Resolve the clipboard implementation for one call. */
function resolveClipboard(override) {
  if (override !== undefined) return override;
  try {
    if (typeof navigator !== 'undefined' && navigator && navigator.clipboard) return navigator.clipboard;
  } catch {
    /* A throwing getter is the same as an unavailable clipboard. */
  }
  return null;
}

/**
 * Copy one string with `navigator.clipboard.writeText`, never throwing.
 *
 * @param text - the text to copy (anything; stringified, null becomes '').
 * @param options - `clipboard` seam (use `null` to simulate an unavailable
 *   clipboard; omit it to use `navigator.clipboard`).
 * @returns `{ok:true, reason:null}` on success; `{ok:false, reason:'unavailable'}`
 *   when no clipboard implementation exists; `{ok:false, reason:'failed', message}`
 *   when `writeText` throws or is not a function.
 */
export async function copyText(text, options = {}) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  const clipboard = resolveClipboard(options && options.clipboard);
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return { ok: false, reason: 'unavailable', message: null };
  }
  try {
    await clipboard.writeText(value);
    return { ok: true, reason: null, message: null };
  } catch (error) {
    return { ok: false, reason: 'failed', message: errorText(error) };
  }
}

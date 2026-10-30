/**
 * Virtual clock. Normally wall time; `?now=2026-10-29T12:50:30` (local) and
 * `?speed=60` start it elsewhere for testing, and settings previews travel
 * to just before an athan.
 */
let anchorReal = Date.now();
let anchorVirtual = anchorReal;
let speed = 1;

const params = new URLSearchParams(globalThis.location?.search ?? '');
const startAt = params.get('now');
if (startAt) {
  const t = new Date(startAt).getTime();
  if (Number.isFinite(t)) anchorVirtual = t;
}
const sp = Number(params.get('speed'));
if (Number.isFinite(sp) && sp > 0) speed = sp;

export const timeTravelled = () => anchorVirtual !== anchorReal || speed !== 1;

export function now(): Date {
  return new Date(anchorVirtual + (Date.now() - anchorReal) * speed);
}

/** Jump to `t` (null returns to wall time). */
export function travelTo(t: Date | null): void {
  anchorReal = Date.now();
  anchorVirtual = t ? t.getTime() : anchorReal;
  if (!t) speed = 1;
}

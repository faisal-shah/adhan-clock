/**
 * Tablet integration. Fully Kiosk Browser exposes `window.fully` when its
 * JavaScript Interface is enabled; elsewhere these calls are no-ops.
 */
interface FullyApi {
  setScreenBrightness(level: number): void;
  turnScreenOn(): void;
}

declare global {
  interface Window {
    fully?: FullyApi;
  }
}

export const underFully = () => typeof window.fully?.setScreenBrightness === 'function';

let lastBrightness = -1;

/** Backlight 0..100 (Fully maps 0..255). */
export function setBrightness(percent: number): void {
  if (!underFully() || percent === lastBrightness) return;
  lastBrightness = percent;
  window.fully!.setScreenBrightness(Math.round((percent / 100) * 255));
}

export function wakeScreen(): void {
  window.fully?.turnScreenOn();
}

/** Keeps the display on in plain Chrome; re-acquired whenever the page becomes visible. */
export function holdWakeLock(): void {
  if (!('wakeLock' in navigator)) return;
  const acquire = () => {
    if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').catch(() => {});
  };
  acquire();
  document.addEventListener('visibilitychange', acquire);
}

export function toggleFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

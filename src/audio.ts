import { effect } from '@preact/signals';
import { setBrightness, wakeScreen } from './core/kiosk';
import { audioBlocked, clock, resolveAudio, settings, tick } from './store';

const athanEl = new Audio();
athanEl.preload = 'auto';
const chimeEl = new Audio();
chimeEl.preload = 'auto';

let playingId: string | null = null;
let retry: (() => void) | null = null;
const handled = new Set<string>();

/**
 * Recordings are played from in-memory blobs. Media elements fetch in byte
 * ranges, which a service-worker precache does not answer reliably offline; a
 * whole-file fetch always comes straight out of the cache.
 */
const blobs = new Map<string, Promise<string>>();

function playable(url: string): Promise<string> {
  if (url.startsWith('blob:')) return Promise.resolve(url);
  let p = blobs.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return r.blob();
      })
      .then((b) => URL.createObjectURL(b));
    p.catch(() => blobs.delete(url));
    blobs.set(url, p);
  }
  return p;
}

/** Warms the blobs for every sound the settings currently use. */
export function preloadSounds(): void {
  const s = settings.value;
  const ids = new Set([
    ...Object.values(s.sounds)
      .filter((c) => c.enabled)
      .map((c) => c.audioId),
    'chime',
  ]);
  if (s.tahajjud.enabled) ids.add(s.tahajjud.audioId);
  for (const id of ids) {
    const a = resolveAudio(id);
    if (a) playable(a.url).catch(() => {});
  }
}

async function start(el: HTMLAudioElement, url: string, volume: number, offsetSec = 0): Promise<void> {
  const src = await playable(url);
  if (el.src !== src) el.src = src;
  el.volume = Math.min(1, Math.max(0, volume));
  el.currentTime = offsetSec;
  try {
    await el.play();
    audioBlocked.value = false;
    retry = null;
  } catch (e) {
    if ((e as DOMException).name === 'NotAllowedError') {
      const blockedAt = Date.now();
      audioBlocked.value = true;
      retry = () => void start(el, url, volume, offsetSec + (Date.now() - blockedAt) / 1000);
    }
  }
}

export function stopAthan(): void {
  athanEl.pause();
  playingId = null;
  retry = null;
}

/** Plays a sound once for the settings screen; returns a stopper. */
export function previewSound(audioId: string, volume: number): () => void {
  const a = resolveAudio(audioId);
  if (!a) return () => {};
  void start(athanEl, a.url, volume);
  playingId = 'preview';
  return stopAthan;
}

/** First tap after a blocked autoplay replays what should be sounding. */
export function unlockAudio(): void {
  audioBlocked.value = false;
  retry?.();
}

/**
 * Drives sound and the backlight from the clock state: chime at the start of
 * the pre-athan countdown, athan from the moment it is due (joined part-way
 * if the page loads late), silence once the sequence is dismissed.
 */
export function startAudioController(): void {
  effect(preloadSounds);
  effect(() => {
    const st = clock.value;
    const s = settings.value;
    const n = tick.value.getTime();
    const t = st?.takeover ?? null;

    if (playingId && playingId !== 'preview' && t?.id !== playingId) stopAthan();
    if (!st) return;

    setBrightness(st.theme === 'night' && !t ? s.night.brightness : s.night.dayBrightness);
    if (!t) return;

    const key = `${t.id}:${t.phase}`;
    if (handled.has(key)) return;

    if (t.phase === 'pre' && s.chime.enabled && n - t.phaseStart.getTime() < 5000) {
      const chime = resolveAudio('chime');
      if (!chime) return; // audio index still loading; retry next tick
      void start(chimeEl, chime.url, s.chime.volume);
    }
    if (t.phase === 'athan') {
      const choice = t.kind === 'tahajjud' ? s.tahajjud : t.prayer ? s.sounds[t.prayer] : null;
      if (choice?.enabled) {
        const a = resolveAudio(choice.audioId);
        if (!a) return; // audio index (or uploads) still loading; retry next tick
        const offset = (n - t.athan.getTime()) / 1000;
        if (a.durationSec === 0 || offset < a.durationSec - 1) {
          playingId = t.id;
          void start(athanEl, a.url, choice.volume, Math.max(0, offset));
        }
      }
    }
    handled.add(key);
    wakeScreen();
  });
}

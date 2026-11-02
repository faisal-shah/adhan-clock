import { effect } from '@preact/signals';
import { setBrightness, wakeScreen } from './core/kiosk';
import { previewRun } from './core/clock';
import { audioBlocked, clock, recordingFor, resolveAudio, settings, tick } from './store';

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

const clampVolume = (v: number) => Math.min(1, Math.max(0, v));

/** Bumped by every start and stop, so a recording still loading when it is stopped or replaced never plays. */
const generation = new Map<HTMLAudioElement, number>();
const nextGeneration = (el: HTMLAudioElement) => {
  const g = (generation.get(el) ?? 0) + 1;
  generation.set(el, g);
  return g;
};

/**
 * Plays `url` on `el`. With `offsetSec` the recording keeps time with the
 * clock (an athan joined part-way stays in step however long it takes to
 * load); without, it plays from the start.
 */
async function start(el: HTMLAudioElement, url: string, volume: number, offsetSec?: number): Promise<void> {
  const gen = nextGeneration(el);
  const asked = Date.now();
  let src: string;
  try {
    src = await playable(url);
  } catch {
    return; // the file could not be fetched; nothing to play
  }
  if (generation.get(el) !== gen) return;
  if (el.src !== src) el.src = src;
  el.volume = clampVolume(volume);
  el.currentTime = offsetSec === undefined ? 0 : offsetSec + (Date.now() - asked) / 1000;
  try {
    await el.play();
    audioBlocked.value = false;
    retry = null;
  } catch (e) {
    if ((e as DOMException).name === 'NotAllowedError') {
      const blockedAt = Date.now();
      audioBlocked.value = true;
      retry = () =>
        void start(el, url, volume, offsetSec === undefined ? undefined : offsetSec + (Date.now() - blockedAt) / 1000);
    }
  }
}

export function stopAthan(): void {
  nextGeneration(athanEl);
  athanEl.pause();
  playingId = null;
  retry = null;
}

/**
 * Plays a sound once for the settings screen and returns a stopper, or
 * returns null while a real athan is playing (a preview would cut it off).
 */
export function previewSound(audioId: string, volume: number): (() => void) | null {
  if (playingId && playingId !== 'preview') return null;
  const a = resolveAudio(audioId);
  if (!a) return null;
  void start(athanEl, a.url, volume);
  playingId = 'preview';
  return stopPreview;
}

/** Follows the volume slider while a preview plays. */
export function setPreviewVolume(volume: number): void {
  if (playingId === 'preview') athanEl.volume = clampVolume(volume);
}

/** Stops a settings preview, leaving an athan that has since started playing. */
export function stopPreview(): void {
  if (playingId === 'preview') stopAthan();
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

    const kind = t.kind === 'tahajjud' ? 'tahajjud' : t.prayer;
    const choice = kind === 'tahajjud' ? s.tahajjud : kind ? s.sounds[kind] : null;
    // The volume follows the settings while the athan plays.
    if (playingId === t.id && choice) athanEl.volume = clampVolume(choice.volume);

    const key = `${previewRun()}:${t.id}:${t.phase}`;
    if (handled.has(key)) return;

    if (t.phase === 'pre' && s.chime.enabled && n - t.phaseStart.getTime() < 5000) {
      const chime = resolveAudio('chime');
      if (!chime) return; // audio index still loading; retry next tick
      void start(chimeEl, chime.url, s.chime.volume);
    }
    if (t.phase === 'athan' && kind && choice?.enabled) {
      const a = recordingFor(kind);
      if (!a) return; // audio index (or uploads) still loading; retry next tick
      const offset = (n - t.athan.getTime()) / 1000;
      if (a.durationSec === 0 || offset < a.durationSec - 1) {
        playingId = t.id;
        void start(athanEl, a.url, choice.volume, Math.max(0, offset));
      }
    }
    handled.add(key);
    wakeScreen();
  });
}

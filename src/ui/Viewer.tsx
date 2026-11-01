import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Photo } from '../core/media';
import { type ClockState, type PeriodKey } from '../core/schedule';
import { BG_SLOTS, type BgSlot } from '../core/settings';
import { backgroundsFor, clock, toggleBackground, viewer, type ViewItem } from '../store';
import { slotShort } from './settings/Library';
import { CalligraphyTheme } from './themes/CalligraphyTheme';
import { GalleryTheme } from './themes/GalleryTheme';
import { Theme } from './themes/Theme';

const SLOT_PERIOD: Record<BgSlot, PeriodKey> = {
  fajr: 'fajr',
  sunrise: 'sunrise',
  dhuhr: 'dhuhr',
  asr: 'asr',
  maghrib: 'maghrib',
  isha: 'isha',
  night: 'tahajjud',
};

export function viewLabel(item: ViewItem): string {
  switch (item.kind) {
    case 'theme':
      return item.label;
    case 'background':
    case 'photo':
      return item.photo.title;
    case 'art':
      return item.art.transliteration ?? item.art.arabic ?? item.art.id;
  }
}

function Content({ item, st }: { item: ViewItem; st: ClockState }) {
  switch (item.kind) {
    case 'theme':
      return <Theme theme={item.theme} st={st} />;
    case 'background': {
      // Show the photo as the calligraphy theme would during its part of the day.
      const shown = { ...st, period: { ...st.period, key: SLOT_PERIOD[item.slot], bg: item.slot } };
      return <CalligraphyTheme st={shown} bg={item.photo} />;
    }
    case 'photo':
      return <GalleryTheme st={st} piece={{ kind: 'photo', id: item.photo.id, photo: item.photo }} />;
    case 'art':
      return <GalleryTheme st={st} piece={{ kind: 'art', id: item.art.id, art: item.art }} />;
  }
}

/** Whether a photo is in a slot's rotation, and whether it is the only one there. */
function membership(slot: BgSlot, photo: Photo): { on: boolean; last: boolean } {
  const set = backgroundsFor(slot);
  const on = set.some((p) => p.id === photo.id);
  return { on, last: on && set.length === 1 };
}

const go = (d: number) => {
  const v = viewer.value!;
  viewer.value = { ...v, index: (v.index + d + v.items.length) % v.items.length };
};
const close = () => (viewer.value = null);

/** Full-screen browser for the showcase: swipe, arrow keys or the side buttons. */
export function Viewer() {
  const v = viewer.value!;
  const st = clock.value!;
  const [chrome, setChrome] = useState(true);
  const down = useRef<{ x: number; y: number } | null>(null);
  const n = v.items.length;
  const item = v.items[v.index];

  // A layout effect, so keys work from the moment the viewer is on screen.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const bg = item.kind === 'background' ? membership(item.slot, item.photo) : null;

  return (
    <div
      class="viewer"
      onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const d = down.current;
        down.current = null;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - d.y)) go(dx < 0 ? 1 : -1);
        else if ((e.target as HTMLElement).closest('.viewer-content')) setChrome(!chrome);
      }}
    >
      <div class={`viewer-content k-${item.kind}`} key={`${item.kind}:${v.index}`}>
        <Content item={item} st={st} />
      </div>
      {chrome && (
        <>
          <div class="viewer-bar">
            <span class="viewer-title">{viewLabel(item)}</span>
            <span class="viewer-count">
              {v.index + 1} / {n}
            </span>
            {item.kind === 'background' && bg && (
              <button
                class={`viewer-use ${bg.on ? 'on' : ''}`}
                disabled={bg.last}
                title={bg.last ? 'A part of the day keeps at least one photo' : undefined}
                onClick={() => toggleBackground(item.slot, item.photo.id)}
              >
                {bg.on ? `In the ${slotShort(item.slot)} set${bg.last ? '' : ' · remove'}` : `Add to ${slotShort(item.slot)}`}
              </button>
            )}
            <button class="viewer-close" aria-label="Close preview" onClick={close}>
              ×
            </button>
          </div>
          {item.kind === 'photo' && (
            <div class="viewer-slots">
              <span>Background for</span>
              {BG_SLOTS.map((slot) => {
                const m = membership(slot, item.photo);
                return (
                  <button
                    class={`chip ${m.on ? 'on' : ''}`}
                    aria-pressed={m.on}
                    disabled={m.last}
                    title={m.last ? 'A part of the day keeps at least one photo' : undefined}
                    onClick={() => toggleBackground(slot, item.photo.id)}
                  >
                    {slotShort(slot)}
                  </button>
                );
              })}
            </div>
          )}
          {n > 1 && (
            <>
              <button class="viewer-nav prev" aria-label="Previous" onClick={() => go(-1)}>
                ‹
              </button>
              <button class="viewer-nav next" aria-label="Next" onClick={() => go(1)}>
                ›
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'preact/hooks';
import { PERIOD_NAMES, type ClockState, type PeriodKey } from '../core/schedule';
import type { BgSlot } from '../core/settings';
import { clock, settings, updateSettings, viewer, type ViewItem } from '../store';
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
      return item.bg.caption ?? PERIOD_NAMES[SLOT_PERIOD[item.bg.slot]];
    case 'gallery':
      return item.item.title;
    case 'art':
      return item.art.transliteration ?? item.art.arabic ?? item.art.id;
  }
}

function Content({ item, st }: { item: ViewItem; st: ClockState }) {
  switch (item.kind) {
    case 'theme':
      return <Theme theme={item.theme} st={st} />;
    case 'background': {
      const b = item.bg;
      const key = SLOT_PERIOD[b.slot];
      // Show the photo as the calligraphy theme would during its period.
      const shown = { ...st, period: { ...st.period, key, bg: b.slot } };
      return (
        <CalligraphyTheme st={shown} bg={{ id: b.id, url: `/backgrounds/${b.file}`, textTone: b.textTone, caption: b.caption }} />
      );
    }
    case 'gallery':
      return <GalleryTheme st={st} piece={{ kind: 'photo', id: item.item.id, item: item.item }} />;
    case 'art':
      return <GalleryTheme st={st} piece={{ kind: 'art', id: item.art.id, art: item.art }} />;
  }
}

/** Full-screen browser for the showcase: swipe, arrow keys or the side buttons. */
export function Viewer() {
  const v = viewer.value!;
  const st = clock.value!;
  const [chrome, setChrome] = useState(true);
  const down = useRef<{ x: number; y: number } | null>(null);
  const n = v.items.length;
  const item = v.items[v.index];
  const go = (d: number) => (viewer.value = { ...v, index: (v.index + d + n) % n });
  const close = () => (viewer.value = null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const bg = item.kind === 'background' ? item.bg : null;
  const inUse = bg && settings.value.backgrounds[bg.slot] === bg.id;

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
            {bg && (
              <button
                class={`viewer-use ${inUse ? 'on' : ''}`}
                onClick={() => updateSettings((s) => ({ backgrounds: { ...s.backgrounds, [bg.slot]: inUse ? 'auto' : bg.id } }))}
              >
                {inUse
                  ? `Kept for ${PERIOD_NAMES[SLOT_PERIOD[bg.slot]]} · undo`
                  : `Use for ${PERIOD_NAMES[SLOT_PERIOD[bg.slot]]}`}
              </button>
            )}
            <button class="viewer-close" aria-label="Close preview" onClick={close}>
              ×
            </button>
          </div>
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

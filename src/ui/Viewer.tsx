import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Photo } from '../core/media';
import type { ClockState } from '../core/schedule';
import { BG_SLOTS, type BgSlot } from '../core/settings';
import { chosenBackgrounds, clock, clockInSlot, toggleBackground, viewer, type ViewItem } from '../store';
import { slotShort } from './settings/Library';
import { CalligraphyTheme } from './themes/CalligraphyTheme';
import { GalleryTheme } from './themes/GalleryTheme';
import { Theme } from './themes/Theme';

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
    case 'background':
      // The photo as the calligraphy theme shows it during its part of today.
      return <CalligraphyTheme st={clockInSlot(item.slot, st.today)} bg={item.photo} />;
    case 'photo':
      return <GalleryTheme st={st} piece={{ kind: 'photo', id: item.photo.id, photo: item.photo }} />;
    case 'art':
      return <GalleryTheme st={st} piece={{ kind: 'art', id: item.art.id, art: item.art }} />;
  }
}

/** Whether a photo is chosen for a slot. */
const chosenFor = (slot: BgSlot, photo: Photo) => chosenBackgrounds(slot).includes(photo.id);

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

  const inSet = item.kind === 'background' && chosenFor(item.slot, item.photo);

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
            {item.kind === 'background' && (
              <button class={`viewer-use ${inSet ? 'on' : ''}`} onClick={() => toggleBackground(item.slot, item.photo.id)}>
                {inSet ? `In the ${slotShort(item.slot)} set · remove` : `Add to ${slotShort(item.slot)}`}
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
                const on = chosenFor(slot, item.photo);
                return (
                  <button
                    class={`chip ${on ? 'on' : ''}`}
                    aria-pressed={on}
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

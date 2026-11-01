import { useState } from 'preact/hooks';
import type { Photo } from '../../core/media';
import { BG_SLOT_NAMES, BG_SLOTS, GALLERY_CATEGORIES, type BgSlot, type GalleryCategory } from '../../core/settings';
import {
  backgroundsFor,
  defaultBackgrounds,
  photos,
  picking,
  resetBackgrounds,
  settings,
  toggleBackground,
  uploadPhotos,
  viewer,
  type ViewItem,
} from '../../store';

/** "Fajr", "Sunrise", ... "Night": the first word of the slot's name. */
export const slotShort = (slot: BgSlot) => BG_SLOT_NAMES[slot].split(' ')[0];

/** Photo categories in display order: the bundled ones, then the user's uploads. */
export const PHOTO_CATEGORIES = (Object.keys(GALLERY_CATEGORIES) as GalleryCategory[]).filter((c) => c !== 'calligraphy');

/** A thumbnail framed as the photo is shown: scenes cropped at their focus, objects whole. */
export function PhotoThumb({ photo }: { photo: Photo }) {
  return (
    <span
      class={`ph-thumb ${photo.fit}`}
      style={{
        backgroundImage: `url(${photo.thumb})`,
        backgroundPosition: photo.fit === 'cover' ? (photo.focus ?? '50% 50%') : undefined,
      }}
    />
  );
}

/** For each photo id, the parts of the day whose rotation includes it. */
export function slotsByPhoto(): Map<string, BgSlot[]> {
  const out = new Map<string, BgSlot[]>();
  for (const slot of BG_SLOTS) for (const p of backgroundsFor(slot)) out.set(p.id, [...(out.get(p.id) ?? []), slot]);
  return out;
}

/** A tile that adds photos from the tablet to the library. */
export function UploadTile({ onAdded }: { onAdded?: (ids: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <label class={`up-tile ${busy ? 'busy' : ''}`}>
      <span class="up-plus">+</span>
      <span class="up-text">{busy ? 'Adding…' : error || 'Add photos'}</span>
      <input
        type="file"
        accept="image/*"
        multiple
        hidden
        disabled={busy}
        onChange={async (e) => {
          const input = e.target as HTMLInputElement;
          const files = [...(input.files ?? [])];
          input.value = '';
          if (!files.length) return;
          setBusy(true);
          setError('');
          try {
            const ids = await uploadPhotos(files);
            onAdded?.(ids);
          } catch {
            setError('That file could not be read as a photo');
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

/** Full-screen chooser for one part of the day: any photo in the library, or a new upload. */
export function BackgroundPicker() {
  const slot = picking.value!;
  const [hint, setHint] = useState('');
  const chosen = new Set(backgroundsFor(slot).map((p) => p.id));
  const custom = settings.value.backgrounds[slot] !== null;
  const suggested = new Set(defaultBackgrounds(slot));
  const all = photos.value;
  const groups: { title: string; photos: Photo[]; uploads?: boolean }[] = [
    { title: `Suggested for ${slotShort(slot)}`, photos: all.filter((p) => suggested.has(p.id)) },
    ...PHOTO_CATEGORIES.map((c) => ({
      title: GALLERY_CATEGORIES[c],
      photos: all.filter((p) => p.category === c && !suggested.has(p.id)),
      uploads: c === 'uploads',
    })),
  ];
  const items: ViewItem[] = groups.flatMap((g) => g.photos.map((photo) => ({ kind: 'background' as const, photo, slot })));
  const toggle = (p: Photo) => {
    if (chosen.has(p.id) && chosen.size === 1) {
      setHint('Keep at least one photo');
      return;
    }
    setHint('');
    toggleBackground(slot, p.id);
  };
  let index = 0;
  return (
    <div class="picker" role="dialog" aria-label={`${BG_SLOT_NAMES[slot]} backgrounds`}>
      <header class="picker-head">
        <div>
          <h2>{BG_SLOT_NAMES[slot]}</h2>
          <p class={hint ? 'warn' : ''}>
            {hint ||
              `${chosen.size} ${chosen.size === 1 ? 'photo' : 'photos'} chosen${chosen.size > 1 ? ', a different one each day' : ''}`}
          </p>
        </div>
        {custom && (
          <button class="btn" onClick={() => resetBackgrounds(slot)}>
            Use the suggested
          </button>
        )}
        <button class="btn primary" onClick={() => (picking.value = null)}>
          Done
        </button>
      </header>
      <div class="picker-body">
        {groups.map(
          (g) =>
            (g.photos.length > 0 || g.uploads) && (
              <section class="pk-group">
                <div class="panel-sub">{g.title}</div>
                <div class="pk-grid">
                  {g.uploads && (
                    <UploadTile
                      onAdded={(ids) =>
                        ids.forEach((id) => {
                          toggleBackground(slot, id);
                        })
                      }
                    />
                  )}
                  {g.photos.map((p) => {
                    const i = index++;
                    const on = chosen.has(p.id);
                    return (
                      <div class={`pk-tile ${on ? 'on' : ''}`}>
                        <button class="pk-pick" aria-pressed={on} aria-label={p.title} onClick={() => toggle(p)}>
                          <PhotoThumb photo={p} />
                          <span class="pk-check" aria-hidden="true" />
                        </button>
                        <button
                          class="pk-look"
                          aria-label={`Preview ${p.title}`}
                          onClick={() => (viewer.value = { items, index: i })}
                        >
                          <ExpandIcon />
                        </button>
                        <span class="pk-label">{p.title}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            ),
        )}
      </div>
    </div>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  );
}

import type { GalleryItem } from '../../core/media';
import { startOfDay } from '../../core/prayer';
import { PERIOD_NAMES, type ClockState } from '../../core/schedule';
import { GALLERY_CATEGORIES } from '../../core/settings';
import { gallery, settings } from '../../store';
import { Clock, CountdownPill, Crossfade, MakruhBadge, T, dateLine } from '../parts';

/** Today's order: a seeded shuffle, so each day walks the collection differently. */
function todaysOrder(items: GalleryItem[], day: number): GalleryItem[] {
  // mulberry32
  let seed = day >>> 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function currentGalleryItem(now: Date): GalleryItem | null {
  const g = settings.value.gallery;
  const pool = gallery.value.filter((x) => g.categories[x.category]);
  if (!pool.length) return null;
  const day = Math.floor(startOfDay(now).getTime() / 86_400_000);
  const order = todaysOrder(pool, day);
  const slot = Math.floor((now.getTime() - startOfDay(now).getTime()) / (g.minutes * 60_000));
  return order[slot % order.length];
}

function Photo({ item }: { item: GalleryItem }) {
  const url = `/gallery/${item.file}`;
  if (item.fit === 'contain') {
    return (
      <div class="gl-photo contain">
        <img class="gl-blur" src={url} alt="" />
        <img class="gl-object" src={url} alt="" />
      </div>
    );
  }
  return (
    <div class="gl-photo">
      <img class="gl-cover" src={url} alt="" style={{ objectPosition: item.focus ?? '50% 50%' }} />
    </div>
  );
}

export function GalleryTheme({ st }: { st: ClockState }) {
  const item = currentGalleryItem(st.now);
  return (
    <div class={`gl ${item?.fit ?? ''}`}>
      <Crossfade k={item?.id ?? 'none'} ms={2500}>
        {item && <Photo item={item} />}
      </Crossfade>
      <div class="gl-scrim" />

      <div class="gl-top">
        <div class="gl-clock">
          <Clock d={st.now} />
        </div>
        <div class="gl-date">{dateLine(st.now, st.hijri)}</div>
        <CountdownPill st={st} />
        <MakruhBadge st={st} />
      </div>

      {item && (
        <div class="gl-caption" key={item.id}>
          <div class="gl-cat">{GALLERY_CATEGORIES[item.category]}</div>
          <div class="gl-title">{item.title}</div>
          <div class="gl-sub">{item.subtitle}</div>
        </div>
      )}

      <div class="gl-strip">
        {st.slots.map((slot) => (
          <div class={`gl-p ${slot.id === st.current.id ? 'current' : ''}`}>
            <span class="gl-p-name">{PERIOD_NAMES[slot.name]}</span>
            <T d={slot.athan} />
          </div>
        ))}
      </div>
    </div>
  );
}

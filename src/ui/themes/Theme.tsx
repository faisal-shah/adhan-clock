import type { ClockState } from '../../core/schedule';
import type { ThemeKey } from '../../core/settings';
import { CalligraphyTheme } from './CalligraphyTheme';
import { ClassicTheme } from './ClassicTheme';
import { GalleryTheme } from './GalleryTheme';
import { KidsTheme } from './KidsTheme';
import { NightTheme } from './NightTheme';

export function Theme({ theme, st }: { theme: ThemeKey; st: ClockState }) {
  switch (theme) {
    case 'classic':
      return <ClassicTheme st={st} />;
    case 'kids':
      return <KidsTheme st={st} />;
    case 'night':
      return <NightTheme st={st} />;
    case 'gallery':
      return <GalleryTheme st={st} />;
    default:
      return <CalligraphyTheme st={st} />;
  }
}

import '@fontsource/noto-serif-display/latin-400.css';
import '@fontsource/marcellus/latin-400.css';
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import '@fontsource/playfair-display/latin-900.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-500-italic.css';
import '@fontsource/aref-ruqaa/arabic-700.css';
import '@fontsource/noto-nastaliq-urdu/arabic-700.css';
import '@fontsource/reem-kufi/arabic-700.css';
import '@fontsource/amiri/arabic-400.css';
import '@fontsource/amiri-quran/arabic-400.css';
import '@fontsource/amiri/arabic-700.css';
import './styles/base.css';
import './styles/calligraphy.css';
import './styles/classic.css';
import './styles/kids.css';
import './styles/gallery.css';
import './styles/night.css';
import './styles/takeover.css';
import './styles/settings.css';

import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { startAudioController } from './audio';
import { holdWakeLock } from './core/kiosk';
import { effect } from '@preact/signals';
import { isPreviewing } from './core/clock';
import { clock, loadMedia, settings, settingsOpen, startWeather, viewer } from './store';
import { App } from './ui/App';

effect(() => {
  document.documentElement.dataset.motion = settings.value.motion;
});

void loadMedia();
startWeather();
startAudioController();
holdWakeLock();

// New deploys install in the background; reload only when nothing is on
// screen that a reload would interrupt: an athan sequence, settings, the
// full-screen viewer or a preview.
const busy = () => !!clock.value?.takeover || settingsOpen.value || !!viewer.value || isPreviewing();
const updateSW = registerSW({
  onNeedRefresh() {
    const tryReload = () => {
      if (busy()) setTimeout(tryReload, 60_000);
      else void updateSW(true);
    };
    tryReload();
  },
  onRegisteredSW(_url, reg) {
    if (reg) setInterval(() => void reg.update(), 30 * 60_000);
  },
});

render(<App />, document.getElementById('app')!);

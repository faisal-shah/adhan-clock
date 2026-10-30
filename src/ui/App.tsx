import { isPreviewing, travelTo } from '../core/clock';
import type { ClockState } from '../core/schedule';
import type { ThemeKey } from '../core/settings';
import { unlockAudio } from '../audio';
import { audioBlocked, clock, settings, settingsOpen, updateSettings } from '../store';
import { Crossfade, GearIcon, SpeakerIcon } from './parts';
import { LocationPicker } from './settings/LocationPicker';
import { SettingsPanel } from './settings/SettingsPanel';
import { CalligraphyTheme } from './themes/CalligraphyTheme';

function Theme({ theme, st }: { theme: ThemeKey; st: ClockState }) {
  switch (theme) {
    default:
      return <CalligraphyTheme st={st} />;
  }
}

function Setup() {
  return (
    <div class="setup">
      <div class="setup-card">
        <div class="setup-bismillah">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>
        <h1>Adhan Clock</h1>
        <p>Prayer times are calculated on this tablet from its location. Choose where this clock lives.</p>
        <LocationPicker onPick={(place) => updateSettings(() => ({ place }))} />
      </div>
    </div>
  );
}

export function App() {
  const st = clock.value;
  if (!settings.value.place) return <Setup />;
  if (!st) return null;
  return (
    <div class={`stage theme-${st.theme}`} onPointerDown={() => audioBlocked.value && unlockAudio()}>
      <Crossfade k={st.theme} ms={1600}>
        <Theme theme={st.theme} st={st} />
      </Crossfade>
      <button class="gear" aria-label="Settings" onClick={() => (settingsOpen.value = true)}>
        <GearIcon />
      </button>
      {audioBlocked.value && (
        <button class="badge-sound" onClick={unlockAudio}>
          <SpeakerIcon /> Tap to enable athan sound
        </button>
      )}
      {isPreviewing() && (
        <div class="preview-bar">
          Preview
          <button class="primary" onClick={() => travelTo(null)}>
            Exit
          </button>
        </div>
      )}
      {settingsOpen.value && <SettingsPanel />}
    </div>
  );
}

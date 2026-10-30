import { getSpeed, isPreviewing, setSpeed, travelTo } from '../core/clock';
import { unlockAudio } from '../audio';
import { audioBlocked, backgroundFor, clock, previewTheme, settings, settingsOpen, updateSettings, viewer } from '../store';
import { Crossfade, GearIcon, Phrase, SpeakerIcon, findArt } from './parts';
import { LocationPicker } from './settings/LocationPicker';
import { SettingsPanel } from './settings/SettingsPanel';
import { TakeoverLayer } from './Takeover';
import { Theme } from './themes/Theme';
import { Viewer } from './Viewer';

function Setup() {
  const bg = backgroundFor('isha', new Date());
  return (
    <div class="setup">
      {bg && <img class="setup-photo" src={bg.url} alt="" />}
      <div class="setup-card">
        <div class="setup-bismillah">
          {findArt('bismillah') ? <Phrase id="bismillah" text="" scale={2} /> : 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ'}
        </div>
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
  const theme = (isPreviewing() && previewTheme.value) || st.theme;
  return (
    <div class={`stage theme-${theme}`} onPointerDown={() => audioBlocked.value && unlockAudio()}>
      <Crossfade k={theme} ms={1600}>
        <Theme theme={theme} st={st} />
      </Crossfade>
      <Crossfade k={st.takeover ? `${st.takeover.id}:${st.takeover.phase}` : 'none'} ms={1000} fadeOut={!st.takeover}>
        {st.takeover && <TakeoverLayer st={st} />}
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
          <span class="preview-when">
            Preview · {st.now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
          <button class={getSpeed() > 1 ? 'on' : ''} onClick={() => setSpeed(getSpeed() > 1 ? 1 : 60)}>
            {getSpeed() > 1 ? '60× · back to 1×' : 'Fast-forward 60×'}
          </button>
          <button
            class="primary"
            onClick={() => {
              travelTo(null);
              previewTheme.value = null;
            }}
          >
            Exit
          </button>
        </div>
      )}
      {settingsOpen.value && <SettingsPanel />}
      {viewer.value && <Viewer />}
    </div>
  );
}

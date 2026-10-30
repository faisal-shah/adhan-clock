import type { ComponentChildren } from 'preact';

export function Row({ label, hint, children }: { label: string; hint?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="row">
      <div class="row-text">
        <div class="row-label">{label}</div>
        {hint && <div class="row-hint">{hint}</div>}
      </div>
      <div class="row-control">{children}</div>
    </div>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button class={`toggle ${value ? 'on' : ''}`} role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <span class="toggle-knob" />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Record<T, string> | readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  const entries = (Array.isArray(options) ? options : Object.entries(options)) as [T, string][];
  return (
    <div class="seg">
      {entries.map(([k, label]) => (
        <button class={k === value ? 'on' : ''} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Record<T, string> | readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  const entries = (Array.isArray(options) ? options : Object.entries(options)) as [T, string][];
  return (
    <select class="select" value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}>
      {entries.map(([k, label]) => (
        <option value={k}>{label}</option>
      ))}
    </select>
  );
}

export function Stepper({
  value,
  min,
  max,
  step = 1,
  unit,
  signed = false,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  signed?: boolean;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div class="stepper">
      <button aria-label="Decrease" disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
        −
      </button>
      <span class="stepper-value">
        {signed && value > 0 ? '+' : ''}
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <button aria-label="Increase" disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
        +
      </button>
    </div>
  );
}

export function Slider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      class="slider"
      type="range"
      min={0}
      max={100}
      value={Math.round(value * 100)}
      style={{ '--fill': `${Math.round(value * 100)}%` }}
      onInput={(e) => onChange(Number((e.target as HTMLInputElement).value) / 100)}
    />
  );
}

export function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input class="time-input" type="time" value={value} onChange={(e) => onChange((e.target as HTMLInputElement).value)} />
  );
}

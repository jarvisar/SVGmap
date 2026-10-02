import { type CSSProperties, type ReactNode, useEffect, useId, useState } from 'react';

export function Section(props: { title: string; summary?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <section className={open ? 'section' : 'section closed'}>
      <button type="button" className="section-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        {props.title}
        {!open && props.summary ? <span className="summary">{props.summary}</span> : null}
      </button>
      {open ? <div className="section-body">{props.children}</div> : null}
    </section>
  );
}

export function Disclosure(props: { label: string; children: ReactNode }) {
  return (
    <details className="disclosure">
      <summary>{props.label}</summary>
      {props.children}
    </details>
  );
}

export function Field(props: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint ? <div className="hint">{props.hint}</div> : null}
    </div>
  );
}

// Up to three decimals, or more if the step needs them.
function format(value: number, step: number): string {
  const decimals = Math.min(6, Math.max(3, (String(step).split('.')[1] ?? '').length));
  return String(Number(value.toFixed(decimals)));
}

// Drops float noise like 0.30000000000000004 after stepping.
const tidy = (value: number) => Number(value.toFixed(9));

// Commits on Enter or blur so typing isn't interrupted by clamping. scale shows
// the value multiplied, e.g. 100 to edit a fraction as a percentage. min, max
// and step are in the shown units.
export function NumberInput(props: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  scale?: number;
  unit?: string;
  label?: string;
  disabled?: boolean;
}) {
  const step = props.step ?? 0.1;
  const scale = props.scale ?? 1;
  const shown = format(props.value * scale, step);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  const change = (value: number) => {
    const next = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, value));
    if (next !== Number(shown)) props.onChange(tidy(next / scale));
    setText(format(next, step));
  };
  const commit = () => {
    // Tabbing through a field shouldn't round what's stored.
    if (text === shown) return;
    const parsed = Number(text.replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(parsed)) setText(shown);
    else change(parsed);
  };

  return (
    <div className="input-unit">
      <input
        className="input"
        inputMode="decimal"
        aria-label={props.label}
        disabled={props.disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            change(tidy(Number(shown) + (e.key === 'ArrowUp' ? step : -step)));
          }
        }}
      />
      {props.unit ? <span className="unit">{props.unit}</span> : null}
    </div>
  );
}

export function NumberField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  scale?: number;
  unit?: string;
  hint?: ReactNode;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      <NumberInput {...props} />
    </Field>
  );
}

// The number box next to the slider can go past the slider's range.
export function Slider(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  scale?: number;
  unit?: string;
  hint?: ReactNode;
}) {
  const scale = props.scale ?? 1;
  const progress = Math.min(100, Math.max(0, ((props.value * scale - props.min) / (props.max - props.min)) * 100));
  return (
    <Field label={props.label} hint={props.hint}>
      <div className="slider">
        <input
          type="range"
          style={{ '--progress': `${progress}%` } as CSSProperties}
          aria-label={props.label}
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value * scale}
          onChange={(e) => props.onChange(tidy(Number(e.target.value) / scale))}
        />
        <NumberInput
          value={props.value}
          onChange={props.onChange}
          step={props.step}
          scale={scale}
          unit={props.unit}
          label={props.label}
        />
      </div>
    </Field>
  );
}

export function LockIcon(props: { locked: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2.5" y="6.5" width="9" height="6" rx="1" />
      <path d={props.locked ? 'M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0v2' : 'M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0'} />
    </svg>
  );
}

export function Check(props: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <label className={props.disabled ? 'check disabled' : 'check'} title={props.title}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          className={o.value === props.value ? 'active' : undefined}
          title={o.title}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>(props: {
  value: T;
  options: { value: T; label: string; group?: string }[];
  onChange: (value: T) => void;
  label?: string;
  className?: string;
}) {
  const groups = new Map<string, { value: T; label: string }[]>();
  for (const o of props.options) {
    const key = o.group ?? '';
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return (
    <select
      className={props.className ?? 'select'}
      aria-label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as T)}
    >
      {[...groups.entries()].map(([group, options]) =>
        group ? (
          <optgroup key={group} label={group}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : (
          options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        ),
      )}
    </select>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; group?: string }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      <Select value={props.value} options={props.options} onChange={props.onChange} label={props.label} />
    </Field>
  );
}

// commitOnBlur waits for Enter or blur, for values that are expensive to apply
// half typed, like a URL.
export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  commitOnBlur?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  const commit = () => {
    if (text !== props.value) props.onChange(text);
  };
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        className="input"
        value={text}
        placeholder={props.placeholder}
        onChange={(e) => {
          setText(e.target.value);
          if (!props.commitOnBlur) props.onChange(e.target.value);
        }}
        onBlur={props.commitOnBlur ? commit : undefined}
        onKeyDown={props.commitOnBlur ? (e) => e.key === 'Enter' && commit() : undefined}
      />
      {props.hint ? <div className="hint">{props.hint}</div> : null}
    </div>
  );
}

export function ColorInput(props: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <input
      type="color"
      className="swatch"
      aria-label={props.label}
      title={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value.toUpperCase())}
    />
  );
}

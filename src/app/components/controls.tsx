import { type ReactNode, useEffect, useId, useState } from 'react';

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

const round = (value: number, step: number) => {
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))));
  return Number(value.toFixed(decimals));
};

// Commits on Enter or blur so typing isn't interrupted by clamping.
export function NumberInput(props: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
}) {
  const step = props.step ?? 0.1;
  const [text, setText] = useState(String(round(props.value, step)));
  useEffect(() => setText(String(round(props.value, step))), [props.value, step]);
  const commit = () => {
    const parsed = Number(text.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setText(String(round(props.value, step)));
      return;
    }
    const clamped = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, parsed));
    if (clamped !== props.value) props.onChange(clamped);
    setText(String(round(clamped, step)));
  };
  return (
    <div className="input-unit">
      <input
        className="input"
        inputMode="decimal"
        aria-label={props.label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const next = round(props.value + (e.key === 'ArrowUp' ? step : -step), step);
            props.onChange(Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, next)));
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
  unit?: string;
  hint?: ReactNode;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      <NumberInput {...props} />
    </Field>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  hint?: ReactNode;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      <div className="slider">
        <input
          type="range"
          aria-label={props.label}
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onChange={(e) => props.onChange(Number(e.target.value))}
        />
        <NumberInput value={props.value} onChange={props.onChange} step={props.step} unit={props.unit} label={props.label} />
      </div>
    </Field>
  );
}

export function Check(props: { label: ReactNode; checked: boolean; onChange: (checked: boolean) => void; title?: string }) {
  return (
    <label className="check" title={props.title}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
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

export function TextField(props: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        className="input"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
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

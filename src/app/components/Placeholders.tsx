import { PLACEHOLDERS, fillPlaceholders, hasPlaceholders } from '../../engine/text/placeholders.ts';
import { usePlaceholderValues } from '../placeholders.ts';

/** Text with a token added at the end, with a space before it when needed. */
export const withToken = (text: string, token: string) => (text && !/\s$/.test(text) ? `${text} ${token}` : `${text}${token}`);

// A menu that adds a {token} to a field. It always shows "Insert…", since
// picking one adds it rather than choosing a value.
export function PlaceholderMenu(props: { onInsert: (token: string) => void }) {
  return (
    <select
      className="select placeholder-menu"
      aria-label="Insert a placeholder"
      title="Filled in from the map when it's drawn"
      value=""
      onChange={(e) => {
        if (e.target.value) props.onInsert(`{${e.target.value}}`);
      }}
    >
      <option value="">Insert…</option>
      {PLACEHOLDERS.map((p) => (
        <option key={p.token} value={p.token}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

// What a field with {tokens} in it will say on the map.
export function PlaceholderPreview(props: { text: string }) {
  const values = usePlaceholderValues();
  if (!hasPlaceholders(props.text)) return null;
  const shown = fillPlaceholders(props.text, values).trim();
  return (
    <div className="hint placeholder-preview" aria-live="polite">
      Shows as {shown ? `“${shown}”` : 'nothing yet'}
    </div>
  );
}

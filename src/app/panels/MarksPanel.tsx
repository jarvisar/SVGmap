import { hasText, markName } from '../../engine/marks/marks.ts';
import { MARK_SHAPES, SHAPE_ORDER } from '../../engine/marks/shapes.ts';
import { Field, Section } from '../components/controls.tsx';
import { MarkIcon } from '../components/MarkIcon.tsx';
import { MARK_IDEAS, addMark, removeMark, selectMark, startingMark, useMarkUi } from '../marks.ts';
import { useApp } from '../store.ts';
import { MarkEditor } from './MarkEditor.tsx';

export function MarkIdeas() {
  return (
    <div className="mark-ideas">
      {MARK_IDEAS.map((idea) => (
        <button key={idea.name} type="button" className="btn btn-small" onClick={() => addMark(idea.mark)}>
          {idea.mark.shape ? <MarkIcon shape={idea.mark.shape} size={14} /> : null}
          {idea.name}
        </button>
      ))}
    </div>
  );
}

export function MarksPanel() {
  const marks = useApp((s) => s.marks);
  const selected = useMarkUi((s) => s.selected);
  const summary = marks.length === 0 ? 'None' : marks.length === 1 ? markName(marks[0]) : `${marks.length} on the map`;
  return (
    <Section title="Pins & text" summary={summary}>
      <div className="hint">
        Pins, shapes and text on the map, like home or where you met. The map is left out under them. In the preview, the Pins &amp; text button
        lets you put them down with a click and drag them around. Click a pin, shape or text on the map and press Delete to remove it.
      </div>
      <Field label="Add">
        <div className="mark-shapes">
          {SHAPE_ORDER.map((shape) => (
            <button
              key={shape}
              type="button"
              className="mark-shape"
              aria-label={`Add ${shape === 'none' ? 'text' : `a ${MARK_SHAPES[shape].name.toLowerCase()}`}`}
              title={shape === 'none' ? 'Text' : MARK_SHAPES[shape].name}
              onClick={() => addMark(startingMark(shape), undefined, shape === 'none')}
            >
              <MarkIcon shape={shape} />
            </button>
          ))}
        </div>
      </Field>
      <Field label="Ideas">
        <MarkIdeas />
      </Field>
      {marks.length ? (
        <ul className="mark-list" aria-label="Pins and text on the map">
          {marks.map((mark) => {
            const open = mark.id === selected;
            const name = markName(mark);
            return (
              <li key={mark.id} className={open ? 'open' : undefined}>
                <div className="mark-row">
                  <button type="button" className="mark-row-name" aria-expanded={open} onClick={() => selectMark(open ? null : mark.id)}>
                    <MarkIcon shape={mark.shape} size={14} />
                    <span className={hasText(mark) || mark.shape !== 'none' ? undefined : 'mark-row-empty'}>{hasText(mark) || mark.shape !== 'none' ? name : 'Empty text'}</span>
                  </button>
                  <button type="button" className="icon-button" aria-label={`Delete ${name}`} title="Delete" onClick={() => removeMark(mark.id)}>
                    ×
                  </button>
                </div>
                {open ? <MarkEditor mark={mark} /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Section>
  );
}

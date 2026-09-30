import { useEffect, useMemo, useState } from 'react';
import { LayoutError, computeLayout } from '../../engine/layout/layout.ts';
import type { ShapeKind } from '../../engine/layout/shapes.ts';
import { PRODUCT_PRESETS } from '../../engine/presets.ts';
import { Check, Disclosure, Field, NumberField, Section, Segmented, SelectField } from '../components/controls.tsx';
import { useApp } from '../store.ts';

export function SizePanel() {
  const product = useApp((s) => s.product);
  const preset = useApp((s) => s.productPreset);
  const border = useApp((s) => s.border);
  const setProduct = useApp((s) => s.setProduct);
  const applyPreset = useApp((s) => s.applyProductPreset);
  const setBorder = useApp((s) => s.setBorder);

  const layout = useMemo(() => {
    try {
      return { layout: computeLayout(product, border), error: null };
    } catch (error) {
      return { layout: null, error: error instanceof LayoutError ? error.message : String(error) };
    }
  }, [product, border]);

  const m = product.margins;
  const uniformMargin = m.top === m.right && m.top === m.bottom && m.top === m.left;
  const [perSide, setPerSide] = useState(!uniformMargin);
  // A preset with uneven margins opens the per-side editor.
  useEffect(() => {
    if (!uniformMargin) setPerSide(true);
  }, [uniformMargin]);
  const circle = product.shape === 'circle';
  const hexagon = product.shape === 'hexagon';
  // Circles and hexagons shrink evenly, so they only have one margin.
  const even = circle || hexagon;
  const landscape = product.width >= product.height;
  const summary = circle ? `⌀ ${product.width.toFixed(0)} mm` : `${product.width.toFixed(1)} × ${product.height.toFixed(1)} mm`;

  return (
    <Section title="Size" summary={summary} defaultOpen>
      <SelectField
        label="Preset"
        value={preset}
        options={[
          ...PRODUCT_PRESETS.map((p) => ({ value: p.id, label: p.name, group: p.group })),
          { value: 'custom', label: 'Custom', group: 'Other' },
        ]}
        onChange={applyPreset}
      />
      <Field label="Shape">
        <Segmented<ShapeKind>
          label="Shape"
          value={product.shape}
          options={[
            { value: 'rect', label: 'Rectangle' },
            { value: 'rounded', label: 'Rounded' },
            { value: 'circle', label: 'Circle' },
            { value: 'hexagon', label: 'Hexagon' },
          ]}
          onChange={(shape) =>
            setProduct({ shape, cornerRadius: shape === 'rounded' && product.cornerRadius === 0 ? 6 : product.cornerRadius })
          }
        />
      </Field>
      {circle ? (
        <NumberField label="Diameter" value={product.width} min={20} max={2000} step={0.1} unit="mm" onChange={(v) => setProduct({ width: v, height: v })} />
      ) : hexagon ? (
        <NumberField
          label="Width"
          value={product.width}
          min={20}
          max={2000}
          step={0.1}
          unit="mm"
          hint={`Corner to corner. ${product.height.toFixed(1)} mm between the flat sides.`}
          onChange={(width) => setProduct({ width })}
        />
      ) : (
        <>
          <div className="row">
            <NumberField label="Width" value={product.width} min={20} max={2000} step={0.1} unit="mm" onChange={(width) => setProduct({ width })} />
            <NumberField label="Height" value={product.height} min={20} max={2000} step={0.1} unit="mm" onChange={(height) => setProduct({ height })} />
          </div>
          <Field label="Orientation">
            <Segmented<'landscape' | 'portrait'>
              label="Orientation"
              value={landscape ? 'landscape' : 'portrait'}
              options={[
                { value: 'landscape', label: 'Landscape' },
                { value: 'portrait', label: 'Portrait' },
              ]}
              onChange={(o) => {
                if ((o === 'landscape') === landscape || product.width === product.height) return;
                // The margins turn with the sheet: a quarter turn clockwise to
                // portrait and back the other way, so switching twice changes nothing.
                const margins = landscape
                  ? { top: m.left, right: m.top, bottom: m.right, left: m.bottom }
                  : { top: m.right, right: m.bottom, bottom: m.left, left: m.top };
                setProduct({ width: product.height, height: product.width, margins });
              }}
            />
          </Field>
        </>
      )}
      {product.shape === 'rounded' ? (
        <NumberField label="Corner radius" value={product.cornerRadius} min={0} max={200} step={0.5} unit="mm" onChange={(cornerRadius) => setProduct({ cornerRadius })} />
      ) : null}
      {!perSide || even ? (
        <NumberField
          label="Margin"
          value={m.top}
          min={0}
          max={200}
          step={0.05}
          unit="mm"
          hint="Blank edge inside the cut, e.g. the part hidden by a frame."
          onChange={(v) => setProduct({ margins: { top: v, right: v, bottom: v, left: v } })}
        />
      ) : (
        <>
          <div className="row">
            {(['top', 'bottom'] as const).map((side) => (
              <NumberField key={side} label={`${side === 'top' ? 'Top' : 'Bottom'} margin`} value={m[side]} min={0} max={200} step={0.05} unit="mm" onChange={(v) => setProduct({ margins: { ...m, [side]: v } })} />
            ))}
          </div>
          <div className="row">
            {(['left', 'right'] as const).map((side) => (
              <NumberField key={side} label={`${side === 'left' ? 'Left' : 'Right'} margin`} value={m[side]} min={0} max={200} step={0.05} unit="mm" onChange={(v) => setProduct({ margins: { ...m, [side]: v } })} />
            ))}
          </div>
          <div className="hint">Blank edge inside the cut, e.g. the part hidden by a frame.</div>
        </>
      )}
      {!even ? (
        <Check
          label="Different margin per side"
          checked={perSide}
          onChange={(on) => {
            setPerSide(on);
            if (!on) setProduct({ margins: { top: m.top, right: m.top, bottom: m.top, left: m.top } });
          }}
        />
      ) : null}

      <div className="subhead">Border</div>
      <Segmented<'double' | 'single' | 'none'>
        label="Border"
        value={border.style}
        options={[
          { value: 'double', label: 'Double' },
          { value: 'single', label: 'Single' },
          { value: 'none', label: 'None' },
        ]}
        onChange={(style) => setBorder({ style })}
      />
      {border.style !== 'none' ? (
        <Disclosure label="Border measurements">
          <div className="row">
            <NumberField label="Outer gap" value={border.outerGap} min={0} max={50} step={0.05} unit="mm" onChange={(outerGap) => setBorder({ outerGap })} />
            {border.style === 'double' ? (
              <NumberField label="Thick band" value={border.thick} min={0.05} max={20} step={0.05} unit="mm" onChange={(thick) => setBorder({ thick })} />
            ) : null}
          </div>
          <div className="row">
            {border.style === 'double' ? (
              <NumberField label="Band to line" value={border.gap} min={0} max={50} step={0.05} unit="mm" onChange={(gap) => setBorder({ gap })} />
            ) : null}
            <NumberField label="Thin line" value={border.thin} min={0.01} max={5} step={0.05} unit="mm" onChange={(thin) => setBorder({ thin })} />
          </div>
          <NumberField label="Line to map" value={border.innerGap} min={0} max={50} step={0.05} unit="mm" onChange={(innerGap) => setBorder({ innerGap })} />
        </Disclosure>
      ) : null}

      {layout.layout ? (
        <div className="hint">
          Map area {layout.layout.window.w.toFixed(1)} × {layout.layout.window.h.toFixed(1)} mm
        </div>
      ) : (
        <div className="notice error">{layout.error}</div>
      )}
    </Section>
  );
}


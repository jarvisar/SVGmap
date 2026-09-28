import type { CleanupSettings } from '../../engine/lines/cleanup.ts';
import { Check, Disclosure, NumberField, Section, Segmented, Slider } from '../components/controls.tsx';
import { type CleanupPreset, useApp } from '../store.ts';

const PRESET_NAMES: Record<CleanupPreset, string> = {
  off: 'Off',
  light: 'Light',
  standard: 'Standard',
  strong: 'Strong',
  custom: 'Custom',
};

export function CleanupPanel() {
  const preset = useApp((s) => s.cleanupPreset);
  const c = useApp((s) => s.cleanup);
  const setPreset = useApp((s) => s.setCleanupPreset);
  const setCleanup = useApp((s) => s.setCleanup);
  const set = (patch: Partial<CleanupSettings>) => setCleanup(patch);

  const num = (key: keyof CleanupSettings, label: string, step: number, unit?: string, max?: number) => (
    <NumberField
      label={label}
      value={c[key] as number}
      min={0}
      max={max}
      step={step}
      unit={unit}
      onChange={(v) => set({ [key]: v } as Partial<CleanupSettings>)}
    />
  );
  const check = (key: keyof CleanupSettings, label: string) => (
    <Check label={label} checked={c[key] as boolean} onChange={(v) => set({ [key]: v } as Partial<CleanupSettings>)} />
  );

  return (
    <Section title="Line cleanup" summary={PRESET_NAMES[preset]}>
      <Segmented<CleanupPreset>
        label="Cleanup"
        value={preset === 'custom' ? 'standard' : preset}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'light', label: 'Light' },
          { value: 'standard', label: 'Standard' },
          { value: 'strong', label: 'Strong' },
        ]}
        onChange={setPreset}
      />
      {preset === 'custom' ? <div className="hint">Custom settings. Pick a preset to reset them.</div> : null}
      {c.enabled ? (
        <>
          <Slider
            label="Line spacing"
            value={c.lineSpacing}
            min={0}
            max={1.5}
            step={0.01}
            unit="mm"
            onChange={(lineSpacing) => set({ lineSpacing })}
            hint="Parallel lines closer than this are merged. Set it to about the beam or pen width."
          />
          <Disclosure label="All settings">
            <div className="subhead">Joining</div>
            {check('weld', 'Join pieces that meet end to end')}
            {check('weldThroughJunctions', 'Continue through junctions into the straightest street')}
            <div className="row">
              {num('weldTolerance', 'Join tolerance', 0.005, 'mm', 1)}
              {num('junctionMaxTurn', 'Max turn', 1, '°', 90)}
            </div>

            <div className="subhead">Overlaps</div>
            {check('cull', 'Remove lines that double another')}
            {check('wholePaths', 'Keep or drop whole streets')}
            <div className="row">
              {num('parallelAngle', 'Parallel within', 1, '°', 90)}
              {num('shadowFraction', 'Share covered', 0.01, undefined, 1)}
            </div>

            <div className="subhead">Gaps and dead ends</div>
            <div className="row">
              {num('snapGap', 'Close gaps up to', 0.01, 'mm', 5)}
              {num('pruneStubs', 'Remove stubs under', 0.05, 'mm', 10)}
            </div>
            {check('collapseLoops', 'Turn tiny loops into junctions')}
            {num('loopRadius', 'Smallest open loop radius', 0.01, 'mm', 5)}

            <div className="subhead">Footpaths</div>
            {check('aggressivePaths', 'Stronger cleanup for footpaths')}
            <div className="row">
              {num('pathStubs', 'Footpath stubs under', 0.05, 'mm', 10)}
              {num('tangleSpan', 'Tangle size', 0.5, 'mm', 50)}
            </div>
            <div className="row">
              {num('tangleSegments', 'Tangle segments', 1, undefined, 500)}
              {num('tangleRatio', 'Tangle length / size', 0.1, undefined, 20)}
            </div>

            <div className="subhead">Dense areas</div>
            {check('dense', 'Thin out patches that burn dark')}
            <div className="row">
              {num('denseLimit', 'Density limit', 0.1, 'mm/mm²', 20)}
              {num('denseWindow', 'Measured over', 0.1, 'mm', 20)}
            </div>
            <div className="row">
              {num('denseSeparation', 'Spacing there', 0.01, 'mm', 5)}
              {num('denseProtectRank', 'Protect roads up to rank', 1, undefined, 12)}
            </div>
            <div className="row">
              {num('denseHotFraction', 'Share in patch', 0.01, undefined, 1)}
              {num('denseShadowFraction', 'Share doubled', 0.01, undefined, 1)}
            </div>
            <div className="row">
              {num('denseMeshMax', 'Mesh links under', 0.1, 'mm', 20)}
              {num('denseMeshDetour', 'Max detour', 0.1, '×', 20)}
            </div>
            {check('denseCountsFill', 'Count filled areas as dark')}
            {num('denseCoveredScale', 'Limit over filled areas', 0.05, '×', 1)}
            <div className="hint">Rank 6 is residential streets. Anything more important is never removed from a dense patch.</div>
          </Disclosure>
        </>
      ) : null}
    </Section>
  );
}

import { fieldRange } from '../../engine/limits.ts';
import type { CleanupSettings } from '../../engine/lines/cleanup.ts';
import { Check, Disclosure, NumberField, Section, Segmented, Slider } from '../components/controls.tsx';
import type { CleanupPreset } from '../settings.ts';
import { useApp } from '../store.ts';

const PRESET_NAMES: Record<CleanupPreset, string> = {
  off: 'Off',
  light: 'Light',
  standard: 'Standard',
  strong: 'Strong',
  custom: 'Custom',
};

type NumberKey = { [K in keyof CleanupSettings]: CleanupSettings[K] extends number ? K : never }[keyof CleanupSettings];
type BooleanKey = { [K in keyof CleanupSettings]: CleanupSettings[K] extends boolean ? K : never }[keyof CleanupSettings];

export function CleanupPanel() {
  const preset = useApp((s) => s.cleanupPreset);
  const c = useApp((s) => s.cleanup);
  const setPreset = useApp((s) => s.setCleanupPreset);
  const set = useApp((s) => s.setCleanup);

  const num = (key: NumberKey, label: string, step: number, unit?: string) => (
    <NumberField label={label} value={c[key]} {...fieldRange(`cleanup.${key}`)} step={step} unit={unit} onChange={(v) => set({ [key]: v })} />
  );
  // Fractions and multipliers, shown as a percentage.
  const pct = (key: NumberKey, label: string) => (
    <NumberField label={label} value={c[key]} {...fieldRange(`cleanup.${key}`, 100)} step={1} scale={100} unit="%" onChange={(v) => set({ [key]: v })} />
  );
  const check = (key: BooleanKey, label: string) => <Check label={label} checked={c[key]} onChange={(v) => set({ [key]: v })} />;

  return (
    <Section title="Line cleanup" summary={PRESET_NAMES[preset]}>
      <Segmented<CleanupPreset>
        label="Cleanup"
        value={preset}
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
            // Enough for a laser at a usable step, and more when a thick pen needs it.
            max={Math.max(1.5, Math.ceil(c.lineSpacing * 10) / 10)}
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
              {num('weldTolerance', 'Join tolerance', 0.005, 'mm')}
              {num('junctionMaxTurn', 'Max turn', 1, '°')}
            </div>

            <div className="subhead">Overlaps</div>
            {check('cull', 'Remove lines that double another')}
            {check('wholePaths', 'Keep or drop whole streets')}
            <div className="row">
              {num('parallelAngle', 'Parallel within', 1, '°')}
              {pct('shadowFraction', 'Share covered')}
            </div>

            <div className="subhead">Gaps and dead ends</div>
            <div className="row">
              {num('snapGap', 'Close gaps up to', 0.01, 'mm')}
              {num('pruneStubs', 'Remove stubs under', 0.05, 'mm')}
            </div>
            {check('collapseLoops', 'Turn tiny loops into junctions')}
            {num('loopRadius', 'Smallest open loop radius', 0.01, 'mm')}

            <div className="subhead">Footpaths</div>
            {check('aggressivePaths', 'Stronger cleanup for footpaths')}
            <div className="row">
              {num('pathStubs', 'Footpath stubs under', 0.05, 'mm')}
              {num('tangleSpan', 'Tangle size', 0.5, 'mm')}
            </div>
            <div className="row">
              {num('tangleSegments', 'Tangle segments', 1)}
              {num('tangleRatio', 'Tangle length / size', 0.1)}
            </div>

            <div className="subhead">Dense areas</div>
            {check('dense', 'Thin out patches that burn dark')}
            <div className="row">
              {num('denseLimit', 'Density limit', 0.1, 'mm/mm²')}
              {num('denseWindow', 'Measured over', 0.1, 'mm')}
            </div>
            <div className="row">
              {num('denseSeparation', 'Spacing there', 0.01, 'mm')}
              {num('denseProtectRank', 'Protect roads up to rank', 1)}
            </div>
            <div className="row">
              {pct('denseHotFraction', 'Share in patch')}
              {pct('denseShadowFraction', 'Share doubled')}
            </div>
            <div className="row">
              {num('denseMeshMax', 'Mesh links under', 0.1, 'mm')}
              {pct('denseMeshDetour', 'Max detour')}
            </div>
            {check('denseCountsFill', 'Count filled areas as dark')}
            {pct('denseCoveredScale', 'Limit over filled areas')}
            <div className="hint">Rank 6 is residential streets. Anything more important is never removed from a dense patch.</div>
          </Disclosure>
        </>
      ) : null}
    </Section>
  );
}

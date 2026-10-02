import { describe, expect, it } from 'vitest';
import { renderFraction } from './render.ts';

describe('the progress bar', () => {
  it('never goes back as the stages pass, Overture buildings included', () => {
    const steps = [
      renderFraction({ stage: 'tiles', message: '', done: 0, total: 4 }),
      renderFraction({ stage: 'tiles', message: '', done: 4, total: 4 }),
      renderFraction({ stage: 'geometry', message: '' }),
      renderFraction({ stage: 'buildings', message: '', fraction: 0 }),
      renderFraction({ stage: 'buildings', message: '', fraction: 0.5 }),
      renderFraction({ stage: 'buildings', message: '', fraction: 1 }),
      renderFraction({ stage: 'compose', message: '' }),
    ];
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
    expect(steps[5]).toBeLessThan(steps[6]);
    // Out of range fractions stay inside the stage.
    expect(renderFraction({ stage: 'buildings', message: '', fraction: 7 })).toBe(steps[5]);
    expect(renderFraction({ stage: 'buildings', message: '', fraction: -1 })).toBe(steps[3]);
    expect(renderFraction(null)).toBe(0);
  });
});

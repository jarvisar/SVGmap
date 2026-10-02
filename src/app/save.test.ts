import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('saving settings', () => {
  it('keeps a change the browser could not save, and says so', async () => {
    let full = false;
    const saved = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => saved.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (full) throw new DOMException('Quota exceeded', 'QuotaExceededError');
          saved.set(key, value);
        },
        removeItem: (key: string) => saved.delete(key),
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();
    const { useApp, useSaveFailed } = await import('./store.ts');

    useApp.getState().setLabel({ text: 'SAVED' });
    expect(saved.get('svgmap-settings')).toContain('SAVED');
    full = true;
    expect(() => useApp.getState().setLabel({ text: 'UNSAVED' })).not.toThrow();
    expect(useApp.getState().label.text).toBe('UNSAVED');
    expect(useSaveFailed.getState().failed).toBe(true);
    full = false;
    useApp.getState().setLabel({ text: 'SAVED AGAIN' });
    expect(useSaveFailed.getState().failed).toBe(false);
    expect(saved.get('svgmap-settings')).toContain('SAVED AGAIN');
  });
});

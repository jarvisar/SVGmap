// Short messages in the top bar, like "Link copied" or what undo just did.
import { create } from 'zustand';

export const useFlash = create<{ text: string }>(() => ({ text: '' }));

let timer: ReturnType<typeof setTimeout> | undefined;

export function flash(text: string, ms = 2500): void {
  useFlash.setState({ text });
  clearTimeout(timer);
  timer = setTimeout(() => useFlash.setState({ text: '' }), ms);
}

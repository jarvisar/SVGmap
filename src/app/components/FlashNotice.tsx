import { useFlash } from '../flash.ts';

// The top bar has no room for its status on small screens, so messages like
// "Link copied" or what undo just did show down here instead. Hidden by CSS
// on wider screens.
export function FlashNotice() {
  const text = useFlash((s) => s.text);
  if (!text) return null;
  return (
    <div className="toast flash-toast" role="status">
      <span>{text}</span>
    </div>
  );
}

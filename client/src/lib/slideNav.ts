import { useStudio } from '../state/deckStore';
import { flatKeys } from './locate';

/** True when a key event target is an editable field (don't hijack arrows there). */
export function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  if (node.isContentEditable) return true;
  if (node.closest?.('.cm-editor')) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName);
}

/** Move the slide selection one step through the navigator's flattened order. */
export function navigateSlides(direction: 'up' | 'down'): void {
  const { model, selectedKey, selectSlide } = useStudio.getState();
  if (!model) return;
  const keys = flatKeys(model);
  if (keys.length === 0) return;
  const idx = selectedKey ? keys.indexOf(selectedKey) : -1;
  const next =
    idx === -1
      ? 0
      : direction === 'down'
        ? Math.min(keys.length - 1, idx + 1)
        : Math.max(0, idx - 1);
  if (keys[next] && keys[next] !== selectedKey) selectSlide(keys[next]);
}

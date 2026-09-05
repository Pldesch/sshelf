import type { DeckModel } from '@studio/shared';
import { findSlide } from './locate';

/** Open the deck full-screen in a new tab, jumping to the selected slide if any. */
export function presentDeck(deckId: string, model: DeckModel | null, selectedKey: string | null): void {
  const slide = model && selectedKey ? findSlide(model, selectedKey) : null;
  const hash = slide?.id ? `#/${slide.id}` : '';
  window.open(`/decks/${deckId}/presentation.html${hash}`, '_blank', 'noopener');
}

/** Render the deck to a PDF and trigger a browser download. `onState` drives UI/toasts. */
export async function downloadDeckPdf(
  deckId: string,
  onState?: (state: 'start' | 'done' | 'error', message?: string) => void,
): Promise<void> {
  onState?.('start');
  try {
    const res = await fetch(`/api/decks/${deckId}/export.pdf`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Export failed (${res.status})`);
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deckId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    onState?.('done');
  } catch (e) {
    onState?.('error', (e as Error).message);
  }
}

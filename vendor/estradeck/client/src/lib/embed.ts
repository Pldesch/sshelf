/** True when Estradeck is hosted inside Sshelf rather than as a standalone studio. */
export function isSshelfEmbed(): boolean {
  return new URLSearchParams(window.location.search).get('embed') === 'sshelf';
}

export function notifySshelf(type: 'ready' | 'deck-changed', detail: Record<string, unknown> = {}): void {
  if (!isSshelfEmbed() || window.parent === window) return;
  window.parent.postMessage({ channel: 'sshelf:estradeck:v1', type, ...detail }, '*');
}

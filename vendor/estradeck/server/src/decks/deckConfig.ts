import type { DeckConfig } from '@studio/shared';
import { TRANSITIONS, TRANSITION_SPEEDS } from '@studio/shared';
import { readRaw, atomicWrite } from '../deck/io';
import { htmlPath } from './paths';
import { recordHistory } from './history';
import { HttpError } from '../errors';

// Read a config key from the Reveal.initialize({...}) call. We scope the search to
// the text after `Reveal.initialize` and require a quoted value, so CSS `transition:`
// rules and `data-transition="…"` attributes can never match.
function readKey(raw: string, key: string): string | null {
  const start = raw.indexOf('Reveal.initialize');
  const hay = start >= 0 ? raw.slice(start) : raw;
  const m = hay.match(new RegExp('\\b' + key + "\\s*:\\s*['\"]([a-z-]+)['\"]"));
  return m ? m[1] : null;
}

function parseConfig(raw: string): DeckConfig {
  return {
    transition: readKey(raw, 'transition') ?? 'slide',
    transitionSpeed: readKey(raw, 'transitionSpeed') ?? 'default',
  };
}

function setKey(raw: string, key: string, val: string): string {
  const re = new RegExp("(\\b" + key + "\\s*:\\s*['\"])([a-z-]+)(['\"])");
  if (re.test(raw)) return raw.replace(re, '$1' + val + '$3');
  // Key absent — insert it as the first option in the initialize call.
  return raw.replace(/(Reveal\.initialize\s*\(\s*\{)/, `$1\n      ${key}: '${val}',`);
}

export function readDeckConfig(deckId: string): DeckConfig {
  return parseConfig(readRaw(htmlPath(deckId)));
}

export function patchDeckConfig(deckId: string, changes: Partial<DeckConfig>): DeckConfig {
  if (changes.transition != null && !(TRANSITIONS as readonly string[]).includes(changes.transition)) {
    throw new HttpError(400, 'Invalid transition', 'INVALID_TRANSITION');
  }
  if (
    changes.transitionSpeed != null &&
    !(TRANSITION_SPEEDS as readonly string[]).includes(changes.transitionSpeed)
  ) {
    throw new HttpError(400, 'Invalid transition speed', 'INVALID_SPEED');
  }
  let raw = readRaw(htmlPath(deckId));
  if (raw.indexOf('Reveal.initialize') < 0) {
    throw new HttpError(422, 'Deck has no Reveal.initialize() call to configure', 'NO_INIT');
  }
  recordHistory(deckId, raw, 'Changed deck transition');
  if (changes.transition != null) raw = setKey(raw, 'transition', changes.transition);
  if (changes.transitionSpeed != null) raw = setKey(raw, 'transitionSpeed', changes.transitionSpeed);
  atomicWrite(htmlPath(deckId), raw);
  return parseConfig(raw);
}

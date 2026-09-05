/**
 * One-off: create the `syndicats` theme from the end-of-software deck and associate
 * the three existing decks with it. Idempotent-ish — skips theme creation if it exists.
 *
 *   node_modules/.bin/tsx server/src/scripts/seed-syndicats.ts
 */
import { createTheme, readTheme } from '../themes/registry';
import { themeExists } from '../themes/paths';
import { setDeckTheme, deckThemeState } from '../themes/apply';
import { deckExists } from '../decks/paths';

const THEME_ID = 'syndicats';
const SOURCE_DECK = 'end-of-software';
const DECKS = ['end-of-software', 'angus-mcgaiver', 'ki-spotlight'];

function main(): void {
  if (!themeExists(THEME_ID)) {
    const id = createTheme({
      name: 'Syndicats',
      description: 'Syndicats brand palette + fonts (redesign-2026), seeded from the end-of-software deck.',
      fromDeck: SOURCE_DECK,
      ts: Date.now(),
    });
    console.log(`Created theme "${id}" from deck "${SOURCE_DECK}".`);
  } else {
    console.log(`Theme "${THEME_ID}" already exists — leaving it as is.`);
  }

  const theme = readTheme(THEME_ID);
  console.log(`\nTheme variables (${theme.vars.length}):`);
  for (const v of theme.vars) console.log(`  ${v.name}: ${v.value}`);

  console.log('\nAssociating decks:');
  for (const deckId of DECKS) {
    if (!deckExists(deckId)) {
      console.log(`  - ${deckId}: SKIPPED (no such deck)`);
      continue;
    }
    setDeckTheme(deckId, THEME_ID);
    const state = deckThemeState(deckId);
    const ov = state.overrides.map((o) => `${o.name}=${o.value}`).join(', ') || '(none)';
    console.log(`  - ${deckId}: theme=${state.themeId} inSync=${state.inSync} overrides: ${ov}`);
  }
  console.log('\nDone.');
}

main();

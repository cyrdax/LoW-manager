import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('market view defaults to shopping list and shows it before PLEX', () => {
  const marketView = readFileSync(resolve('web/src/components/MarketView.tsx'), 'utf8');
  const defaultIndex = marketView.indexOf("useState<MarketTab>('shopping')");
  const shoppingButton = marketView.indexOf(">Shopping List</button>");
  const plexButton = marketView.indexOf(">PLEX</button>");

  assert.ok(defaultIndex >= 0);
  assert.doesNotMatch(marketView, /efd\.market\.tab/);
  assert.ok(shoppingButton >= 0);
  assert.ok(plexButton >= 0);
  assert.ok(shoppingButton < plexButton);
  assert.match(marketView, /tab === 'shopping' \? <ShoppingListView chars=\{chars\} \/> : <PlexView \/>/);
});

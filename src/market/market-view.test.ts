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

test('shopping list result columns are sortable', () => {
  const marketView = readFileSync(resolve('web/src/components/MarketView.tsx'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(marketView, /sortShoppingListResults\(quote\.items, sort\.key, sort\.direction\)/);
  assert.match(marketView, /<ShoppingSortTh label="Item" sortKey="item"/);
  assert.match(marketView, /<ShoppingSortTh label="Qty" sortKey="requestedQty"/);
  assert.match(marketView, /<ShoppingSortTh label="Filled" sortKey="filledQty"/);
  assert.match(marketView, /<ShoppingSortTh label="Avg price" sortKey="avgPrice"/);
  assert.match(marketView, /<ShoppingSortTh label="Subtotal" sortKey="totalCost"/);
  assert.match(marketView, /<ShoppingSortTh label="Status" sortKey="status"/);
  assert.match(marketView, /aria-sort=\{direction \? \(direction === 'asc' \? 'ascending' : 'descending'\) : 'none'\}/);
  assert.match(styles, /\.mk-shop-sort-btn/);
});

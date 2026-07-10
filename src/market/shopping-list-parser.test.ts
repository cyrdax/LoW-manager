import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateShoppingItems, parseShoppingList } from './shopping-list-parser.ts';

test('parseShoppingList accepts fit-style item lists with duplicates and trailing quantities', () => {
  const parsed = parseShoppingList(`
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Tracking Enhancer II
Tracking Enhancer II
Capital Compact Pb-Acid Cap Battery
Capital Compact Pb-Acid Cap Battery

Tracking Speed Script x2
Hail XL x4057
Barrage XL x9,022
Mobile Tractor Unit x1
`);

  assert.deepEqual(parsed.map(line => ({ name: line.name, qty: line.qty, ok: line.ok })), [
    { name: 'Republic Fleet Gyrostabilizer', qty: 1, ok: true },
    { name: 'Republic Fleet Gyrostabilizer', qty: 1, ok: true },
    { name: 'Tracking Enhancer II', qty: 1, ok: true },
    { name: 'Tracking Enhancer II', qty: 1, ok: true },
    { name: 'Capital Compact Pb-Acid Cap Battery', qty: 1, ok: true },
    { name: 'Capital Compact Pb-Acid Cap Battery', qty: 1, ok: true },
    { name: 'Tracking Speed Script', qty: 2, ok: true },
    { name: 'Hail XL', qty: 4057, ok: true },
    { name: 'Barrage XL', qty: 9022, ok: true },
    { name: 'Mobile Tractor Unit', qty: 1, ok: true },
  ]);

  assert.deepEqual(aggregateShoppingItems(parsed), [
    { name: 'Republic Fleet Gyrostabilizer', qty: 2 },
    { name: 'Tracking Enhancer II', qty: 2 },
    { name: 'Capital Compact Pb-Acid Cap Battery', qty: 2 },
    { name: 'Tracking Speed Script', qty: 2 },
    { name: 'Hail XL', qty: 4057 },
    { name: 'Barrage XL', qty: 9022 },
    { name: 'Mobile Tractor Unit', qty: 1 },
  ]);
});

test('parseShoppingList keeps existing quantity-first and inventory-copy formats', () => {
  const parsed = parseShoppingList(`
2 Cap Recharger II
3x Multispectrum Energized Membrane II
Nanofiber Internal Structure II	4
`);

  assert.deepEqual(parsed.map(line => ({ name: line.name, qty: line.qty, ok: line.ok })), [
    { name: 'Cap Recharger II', qty: 2, ok: true },
    { name: 'Multispectrum Energized Membrane II', qty: 3, ok: true },
    { name: 'Nanofiber Internal Structure II', qty: 4, ok: true },
  ]);
});

test('parseShoppingList flags zero explicit quantities', () => {
  const parsed = parseShoppingList(`
Cap Recharger II x0
0 Nanofiber Internal Structure II
`);

  assert.deepEqual(parsed.map(line => ({ name: line.name, qty: line.qty, ok: line.ok })), [
    { name: 'Cap Recharger II', qty: 0, ok: false },
    { name: 'Nanofiber Internal Structure II', qty: 0, ok: false },
  ]);
});

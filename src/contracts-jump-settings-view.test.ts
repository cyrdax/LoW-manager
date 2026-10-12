import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ContractsView,
  rangeValueForPersistence,
  resolveSavedShip,
} from '../web/src/components/ContractsView.tsx';

test('contracts ship tab renders JDC and cyno jump selectors', () => {
  const html = renderContractsView({});

  assert.match(html, /for="contracts-jdc-level"/);
  assert.match(html, /id="contracts-jdc-level"/);
  assert.match(html, />JDC level</);
  assert.match(html, /for="contracts-cyno-jumps"/);
  assert.match(html, /id="contracts-cyno-jumps"/);
  assert.match(html, />Cyno jumps</);
});

test('contracts any-cap tab renders the same JDC and cyno jump selectors', () => {
  const html = renderContractsView({ 'efd.contracts.searchMode': 'jumpCapable' });

  assert.match(html, /class="active">Any cap jump</);
  assert.match(html, /id="contracts-jdc-level"/);
  assert.match(html, /id="contracts-cyno-jumps"/);
});

test('contracts ship tab explains why a selected non-jump ship cannot be searched', () => {
  const html = renderContractsView({
    'efd.contracts.shipId': '17920',
    'efd.contracts.shipName': 'Barghest',
    'efd.contracts.shipGroupName': 'Battleship',
    'efd.contracts.shipJumpDriveBaseRangeLy': '0',
  });

  assert.match(html, /This ship has no jump drive\./);
});

test('contracts ship tab restores a saved jump-capable ship range', () => {
  const html = renderContractsView({
    'efd.contracts.shipId': '23757',
    'efd.contracts.shipName': 'Archon',
    'efd.contracts.shipGroupName': 'Carrier',
    'efd.contracts.shipJumpDriveBaseRangeLy': '3.5',
  });

  assert.doesNotMatch(html, /This ship has no jump drive\./);
});

test('contracts ship tab treats a legacy saved ship as pending hydration', () => {
  const html = renderContractsView({
    'efd.contracts.shipId': '23757',
    'efd.contracts.shipName': 'Archon',
    'efd.contracts.shipGroupName': 'Carrier',
  });

  assert.match(html, /Refreshing saved ship data…/);
  assert.doesNotMatch(html, /This ship has no jump drive\./);
});

test('legacy saved ships rehydrate by type id from current search data', () => {
  const saved = { id: 23757, name: 'Archon', groupName: 'Carrier', jumpDriveBaseRangeLy: null };
  const current = { id: 23757, name: 'Archon', groupName: 'Carrier', jumpDriveBaseRangeLy: 3.5 };

  assert.deepEqual(resolveSavedShip(saved, [
    { id: 19720, name: 'Revelation', groupName: 'Dreadnought', jumpDriveBaseRangeLy: 3.5 },
    current,
  ]), current);
});

test('legacy ship hydration never overwrites a missing saved range', () => {
  const legacy = { id: 23757, name: 'Archon', groupName: 'Carrier', jumpDriveBaseRangeLy: null };

  assert.equal(rangeValueForPersistence(legacy, true), undefined);
  assert.equal(rangeValueForPersistence(legacy, false), '0');
  assert.equal(rangeValueForPersistence({ ...legacy, jumpDriveBaseRangeLy: 3.5 }, false), '3.5');
});

function renderContractsView(values: Record<string, string>): string {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map(Object.entries(values));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return storage.size; },
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => [...storage.keys()][index] ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });

  try {
    return renderToStaticMarkup(createElement(ContractsView, { onLoginRequired() {} }));
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
}

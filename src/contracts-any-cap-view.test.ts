import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContractsView } from '../web/src/components/ContractsView.tsx';

test('contracts view restores the any-cap search mode with shared jump settings', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>([
    ['efd.contracts.searchMode', 'jumpCapable'],
    ['efd.contracts.jdcLevel', '3'],
    ['efd.contracts.maxCynoJumps', '4'],
  ]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });

  try {
    const html = renderToStaticMarkup(createElement(ContractsView, { onLoginRequired() {} }));
    assert.match(html, /class="active">Any cap jump</);
    assert.match(html, /id="contracts-ship-input"[^>]*disabled/);
    assert.match(html, /id="contracts-jdc-level"[^>]*>.*value="3" selected/);
    assert.match(html, /id="contracts-cyno-jumps"[^>]*>.*value="4" selected/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

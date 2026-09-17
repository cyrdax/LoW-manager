import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ContractSearchResult } from './contracts/types.ts';
import { ContractResultsTable } from '../web/src/components/ContractsView.tsx';

test('contracts results render the sortable JFC V fuel amount and isotope type', () => {
  const markup = renderToStaticMarkup(createElement(ContractResultsTable, {
    rows: [contractResult()],
    onOpenDetails: () => {},
  }));

  assert.match(markup, /Fuel \(JFC V\)/);
  assert.match(markup, /10,401/);
  assert.match(markup, /Helium Isotopes/);
});

function contractResult(): ContractSearchResult {
  return {
    contractId: 101,
    type: 'item_exchange',
    title: 'Archon hull',
    price: 1_000_000_000,
    buyout: null,
    effectivePrice: 1_000_000_000,
    quantity: 1,
    shipTypeId: 23_757,
    shipName: 'Archon',
    regionId: 10_000_002,
    regionName: 'The Forge',
    systemId: 30_000_148,
    systemName: 'Urlen',
    locationName: 'Urlen Station',
    locationKnown: true,
    jumps: 2,
    capitalJumps: 1,
    jumpFuelTypeId: 16_274,
    jumpFuelTypeName: 'Helium Isotopes',
    jumpFuelAmount: 10_401,
    dateIssued: '2026-09-10T00:00:00Z',
    dateExpired: '2026-09-17T00:00:00Z',
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatContractSearchSummaryLine } from './summary-copy.ts';

test('formats jump-capable contract summary in EVE time', () => {
  const line = formatContractSearchSummaryLine({
    mode: 'jumpCapable',
    resultCount: 108,
    originName: 'Neda',
    radius: 1,
    fetchedAt: Date.UTC(2026, 7, 12, 23, 37),
  });

  assert.equal(line, '108 jump-capable ships within 1 cyno jump of Neda. Updated 23:37 eve time Aug 12');
});


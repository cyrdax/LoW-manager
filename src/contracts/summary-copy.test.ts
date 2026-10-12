import assert from 'node:assert/strict';
import test from 'node:test';
import { formatContractSearchSummaryLine } from './summary-copy.ts';

test('formats jump-capable contract summary in EVE time', () => {
  const input = {
    mode: 'jumpCapable',
    resultCount: 108,
    originName: 'Neda',
    jdcLevel: 4,
    maxCynoJumps: 2,
    fetchedAt: Date.UTC(2026, 7, 12, 23, 37),
  } as const;
  const line = formatContractSearchSummaryLine(input);

  assert.equal(line, '108 jump-capable ships within 2 cyno jumps of Neda at JDC IV. Updated 23:37 eve time Aug 12');
});

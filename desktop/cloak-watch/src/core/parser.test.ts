import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseListener,
  parseLogEntry,
  sanitizeEveMessage,
  toDecloakEvent,
} from './parser.js';

const positives = [
  'Your cloak deactivates due to proximity to a nearby Scourge Light Missile.',
  'Your cloak deactivates due to a pulse from a Mobile Observatory.',
  'Your cloaking device has been forcibly deactivated.',
  'You have been decloaked by a nearby object.',
];

const negatives = [
  'Improved Cloaking Device II fails to activate as it is still recovering from its last period of operation and will be for the next 26 seconds.',
  'Your cloaking systems are unable to activate due to your ship being within 2000 meters of the nearby Refinery.',
  'You cannot cloak your ship as you are being targeted by someone.',
  'Interference from the cloaking you are doing is preventing your systems from functioning at this time.',
  'Covert Ops Cloaking Device II is active.',
];

const context = {
  characterName: 'Cyrdax Prime',
  sourceFile: '/logs/Chatlogs/Listener_20260923.log',
  byteOffset: 1842,
};

test('parseListener extracts the trimmed listener name to prevent missed character attribution', () => {
  assert.equal(parseListener('  Listener: Cyrdax Prime'), 'Cyrdax Prime');
});

test('parseLogEntry converts the standard EVE header to UTC to prevent wrong event times', () => {
  assert.deepEqual(
    parseLogEntry('[ 2026.09.23 03:04:05 ] (notify) Your cloak deactivates due to proximity to a nearby ship.'),
    {
      occurredAt: '2026-09-23T03:04:05.000Z',
      category: 'notify',
      message: 'Your cloak deactivates due to proximity to a nearby ship.',
    },
  );
});

test('sanitizeEveMessage removes EVE markup and decodes entities to prevent raw markup in alerts', () => {
  assert.equal(
    sanitizeEveMessage('<color=0xffffffff>Your cloak deactivates</color> due to proximity.'),
    'Your cloak deactivates due to proximity.',
  );
  assert.equal(
    sanitizeEveMessage(' <url=showinfo:1>Cloak</url>&amp; &lt;nearby&gt; &quot;ship&quot; '),
    'Cloak& <nearby> "ship"',
  );
});

test('toDecloakEvent classifies every representative decloak message to prevent missed alerts', () => {
  for (const message of positives) {
    const entry = parseLogEntry(`[ 2026.09.23 03:04:05 ] (notify) ${message}`);

    assert.deepEqual(toDecloakEvent(entry, context), {
      characterName: 'Cyrdax Prime',
      occurredAt: '2026-09-23T03:04:05.000Z',
      message,
      sourceFile: '/logs/Chatlogs/Listener_20260923.log',
      byteOffset: 1842,
    });
  }
});

test('toDecloakEvent excludes every representative failed-cloak message to prevent false alerts', () => {
  for (const message of negatives) {
    const entry = parseLogEntry(`[ 2026.09.23 03:04:05 ] (notify) ${message}`);

    assert.equal(toDecloakEvent(entry, context), null);
  }
});

test('toDecloakEvent supplies the fallback character to prevent anonymous alerts', () => {
  const entry = parseLogEntry(
    '[ 2026.09.23 03:04:05 ] (notify) Your cloak deactivates due to proximity to a nearby ship.',
  );

  assert.deepEqual(
    toDecloakEvent(entry, { ...context, characterName: null }),
    {
      characterName: 'Unknown EVE client',
      occurredAt: '2026-09-23T03:04:05.000Z',
      message: 'Your cloak deactivates due to proximity to a nearby ship.',
      sourceFile: '/logs/Chatlogs/Listener_20260923.log',
      byteOffset: 1842,
    },
  );
});

test('toDecloakEvent rejects malformed log entries to prevent untrustworthy alerts', () => {
  const malformedEntries = [
    '2026.09.23 03:04:05 (notify) Your cloak deactivates due to proximity.',
    '[ 2026.09.23 03:04:05 ] notify Your cloak deactivates due to proximity.',
    '[ 2026.13.23 03:04:05 ] (notify) Your cloak deactivates due to proximity.',
    '',
  ];

  for (const line of malformedEntries) {
    assert.equal(toDecloakEvent(parseLogEntry(line), context), null);
  }
});

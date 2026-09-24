import assert from 'node:assert/strict';
import test from 'node:test';

import { detectEncoding, StreamingLineDecoder } from './line-decoder.js';

const sample = [
  '  Listener: Cyrdax Prime',
  '[ 2026.09.23 03:04:05 ] (notify) Your cloak deactivates due to proximity.',
  '',
].join('\r\n');

test('StreamingLineDecoder retains complete UTF-8 and UTF-16LE lines across every chunk boundary to prevent lost log entries', () => {
  for (const encoding of ['utf8', 'utf16le'] as const) {
    const encoded = Buffer.from(sample, encoding);
    for (let split = 1; split < encoded.length; split += 1) {
      const decoder = new StreamingLineDecoder(encoding);
      const lines = [
        ...decoder.push(encoded.subarray(0, split), 0),
        ...decoder.push(encoded.subarray(split), split),
      ];

      assert.deepEqual(lines.map((line) => line.text), [
        '  Listener: Cyrdax Prime',
        '[ 2026.09.23 03:04:05 ] (notify) Your cloak deactivates due to proximity.',
      ]);
    }
  }
});

test('detectEncoding identifies UTF-8 and UTF-16LE byte order marks to decode EVE logs correctly', () => {
  assert.equal(detectEncoding(Uint8Array.from([0xef, 0xbb, 0xbf, 0x4c])), 'utf8');
  assert.equal(detectEncoding(Uint8Array.from([0xff, 0xfe, 0x4c, 0x00])), 'utf16le');
  assert.equal(detectEncoding(Uint8Array.from([0x4c, 0x69, 0x73, 0x74])), 'utf8');
});

test('StreamingLineDecoder strips only a leading BOM, removes CRLF, and reports hand-derived byte offsets', () => {
  const utf8 = new StreamingLineDecoder('utf8');
  assert.deepEqual(
    utf8.push(Buffer.from('\uFEFFfirst\r\nsecond\r\n', 'utf8'), 0),
    [
      { text: 'first', byteOffset: 0 },
      { text: 'second', byteOffset: 10 },
    ],
  );

  const utf16le = new StreamingLineDecoder('utf16le');
  assert.deepEqual(
    utf16le.push(Buffer.from('\uFEFFfirst\r\nsecond\r\n', 'utf16le'), 0),
    [
      { text: 'first', byteOffset: 0 },
      { text: 'second', byteOffset: 16 },
    ],
  );
});

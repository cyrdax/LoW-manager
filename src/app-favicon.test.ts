import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('app favicon uses Wayne Kerr portrait from EVE images', () => {
  const indexHtml = readFileSync(resolve('web/index.html'), 'utf8');

  assert.match(
    indexHtml,
    /<link rel="icon" type="image\/png" href="https:\/\/images\.evetech\.net\/characters\/231005176\/portrait\?size=64" \/>/,
  );
  assert.match(
    indexHtml,
    /<link rel="apple-touch-icon" href="https:\/\/images\.evetech\.net\/characters\/231005176\/portrait\?size=128" \/>/,
  );
});

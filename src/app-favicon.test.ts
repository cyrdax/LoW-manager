import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('app favicon and preview metadata use Outfit 420-2 branding', () => {
  const indexHtml = readFileSync(resolve('web/index.html'), 'utf8');

  assert.match(
    indexHtml,
    /<link rel="icon" type="image\/png" sizes="32x32" href="\/outfit-icon-32\.png" \/>/,
  );
  assert.match(
    indexHtml,
    /<link rel="apple-touch-icon" href="\/outfit-icon-180\.png" \/>/,
  );
  assert.match(indexHtml, /<meta property="og:image" content="https:\/\/outfit420-2\.com\/outfit-social\.png" \/>/);
  assert.match(indexHtml, /<meta property="og:image:width" content="1200" \/>/);
  assert.match(indexHtml, /<meta property="og:image:height" content="630" \/>/);
  assert.match(indexHtml, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(indexHtml, /<meta name="twitter:image" content="https:\/\/outfit420-2\.com\/outfit-social\.png" \/>/);
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

test('fit item tooltips render instantly instead of using native title delay', () => {
  const view = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const css = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(view, /data-tooltip=\{item\.resolvedName \?\? item\.inputName\}/);
  assert.doesNotMatch(view, /title=\{item\.resolvedName \?\? item\.inputName\}/);
  assert.match(view, /className="fits-floating-tooltip"/);
  assert.match(view, /style=\{\{ left: tooltip\.x, top: tooltip\.y \}\}/);
  assert.match(css, /\.fits-floating-tooltip\s*\{/);
  assert.match(css, /\.fits-floating-tooltip\s*\{[^}]*position: fixed/s);
  assert.doesNotMatch(css, /\.fits-tooltip:hover::after/);
  assert.doesNotMatch(css, /\.fits-tooltip:focus-visible::after/);
});

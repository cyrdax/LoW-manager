import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('planets header and summary rows share one column grid', () => {
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');
  const view = readFileSync(resolve('web/src/components/PlanetsView.tsx'), 'utf8');

  assert.match(styles, /--planets-grid-columns:\s*32px minmax\(180px,\s*2fr\) 110px 90px 130px 140px 40px;/);
  assert.match(styles, /\.planets-header\s*\{[\s\S]*grid-template-columns:\s*var\(--planets-grid-columns\);/);
  assert.match(styles, /\.planet-summary\s*\{[\s\S]*grid-template-columns:\s*var\(--planets-grid-columns\);/);
  assert.match(styles, /\.planets-header \.planet-character-heading\s*\{[\s\S]*grid-column:\s*1\s*\/\s*span\s*2;/);
  assert.match(view, /className="sort-btn planet-character-heading"/);
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('Fits v2 shell is routed and visible as its own fits mode', () => {
  const routes = readFileSync(resolve('web/src/app-routes.ts'), 'utf8');
  const switchView = readFileSync(resolve('web/src/components/FitModeSwitch.tsx'), 'utf8');
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const fitsV2View = readFileSync(resolve('web/src/components/FitsV2View.tsx'), 'utf8');

  assert.match(routes, /first === 'fits' && second === 'v2'/);
  assert.match(routes, /first === 'fit' && second === 'v2'/);
  assert.match(routes, /return `\/fit\/v2\/\$\{route\.fitId\}`/);
  assert.match(switchView, /Fits v2/);
  assert.match(fitsView, /mode === 'fits-v2'/);
  assert.match(fitsView, /<FitsV2View/);
  assert.match(fitsV2View, /Dogma editor foundation/);
  assert.match(fitsV2View, /searchFitItems/);
  assert.match(fitsV2View, /Search modules, drones, cargo/);
  assert.match(fitsV2View, /function saveEditor\(\)/);
  assert.match(fitsV2View, /quoteDraftFit/);
  assert.match(fitsV2View, /Refresh price/);
  assert.match(fitsV2View, /sendDraftFit/);
  assert.match(fitsV2View, /Copy EFT/);
  assert.match(fitsV2View, /Send Fit/);
  assert.match(fitsV2View, /All V/);
  assert.match(fitsV2View, /updateSkillProfile/);
  assert.match(fitsV2View, /Dogma engine/);
  assert.match(fitsV2View, /renderEditorToEft/);
  assert.match(fitsV2View, /hasEditorJson/);
});

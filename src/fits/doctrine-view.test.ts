import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('frontend exposes doctrine api helpers and doctrine view controls', () => {
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const doctrinesView = readFileSync(resolve('web/src/components/DoctrinesView.tsx'), 'utf8');
  const switchView = readFileSync(resolve('web/src/components/FitModeSwitch.tsx'), 'utf8');

  assert.match(api, /export interface DoctrineSummary/);
  assert.match(api, /export interface DoctrineDetail/);
  assert.match(api, /export async function fetchDoctrines/);
  assert.match(api, /export async function addDoctrineFit/);
  assert.match(api, /export async function removeDoctrineFit/);

  assert.match(fitsView, /DoctrinesView/);
  assert.match(switchView, /Fits/);
  assert.match(switchView, /Doctrines/);
  assert.match(doctrinesView, /Search doctrines/);
  assert.match(doctrinesView, /Create doctrine/);
  assert.match(doctrinesView, /Add fit/);
  assert.match(doctrinesView, /Remove/);
});

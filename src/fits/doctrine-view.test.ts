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

test('frontend exposes public and private fit library controls', () => {
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const doctrinesView = readFileSync(resolve('web/src/components/DoctrinesView.tsx'), 'utf8');

  assert.match(api, /export type LibraryVisibility/);
  assert.match(api, /ownerUserId: string \| null/);
  assert.match(api, /visibility: LibraryVisibility/);
  assert.match(api, /sourcePublicFitId: number \| null/);
  assert.match(api, /sourcePublicDoctrineId: number \| null/);
  assert.match(api, /export async function fetchFits\(visibility: LibraryVisibility = 'private'\)/);
  assert.match(api, /export async function publishFit/);
  assert.match(api, /export async function copyFitToPrivate/);
  assert.match(api, /export async function fetchDoctrines\(q = '', visibility: LibraryVisibility = 'private'\)/);
  assert.match(api, /export async function publishDoctrine/);
  assert.match(api, /export async function copyDoctrineToPrivate/);

  assert.match(fitsView, /FITS_VISIBILITY_KEY/);
  assert.match(fitsView, /LibraryScopeSwitch/);
  assert.match(fitsView, /fetchFits\((scope|visibility)\)/);
  assert.match(fitsView, /publishCurrent/);
  assert.match(fitsView, /copyCurrentToPrivate/);
  assert.match(fitsView, /Publish/);
  assert.match(fitsView, /Copy private/);

  assert.match(doctrinesView, /DOCTRINE_VISIBILITY_KEY/);
  assert.match(doctrinesView, /LibraryScopeSwitch/);
  assert.match(doctrinesView, /fetchDoctrines\(q, (scope|visibility)\)/);
  assert.match(doctrinesView, /publishCurrentDoctrine/);
  assert.match(doctrinesView, /copyDoctrineToPrivate/);
  assert.match(doctrinesView, /Publish/);
  assert.match(doctrinesView, /Copy private/);
});

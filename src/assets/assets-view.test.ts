import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { filterAssetSnapshots } from '../../web/src/assets-filter.ts';
import { sortAssetSnapshots } from '../../web/src/assets-sort.ts';
import { buildAssetTree } from './tree.ts';
import type { AssetSnapshot } from './types.ts';

function snapshotWithAssets(characterId: number, characterName: string, assets: Parameters<typeof buildAssetTree>[0]['assets']): AssetSnapshot {
  return buildAssetTree({
    characterId,
    characterName,
    status: 'Ready',
    error: null,
    lastRefreshedAt: 1,
    locations: [
      { locationId: 60003760, name: 'Jita', type: 'station', status: 'resolved' },
      { locationId: 60008494, name: 'Amarr', type: 'station', status: 'resolved' },
    ],
    assets,
  });
}

function emptySnapshot(characterId: number, characterName: string): AssetSnapshot {
  return buildAssetTree({
    characterId,
    characterName,
    status: 'Needs refresh',
    error: null,
    lastRefreshedAt: null,
    locations: [],
    assets: [],
  });
}

test('unfiltered assets view preserves zero-location pilot placeholders', () => {
  const [filtered] = filterAssetSnapshots([emptySnapshot(1, 'Needs Refresh Pilot')], '', 'all');

  assert.equal(filtered.pilot.characterName, 'Needs Refresh Pilot');
  assert.equal(filtered.pilot.locationCount, 0);
  assert.equal(filtered.pilot.itemCount, 0);
  assert.equal(filtered.pilot.stackCount, 0);
  assert.equal(filtered.pilot.totalValue, 0);
  assert.deepEqual(filtered.locations, []);
});

test('asset and search filters hide zero-location pilot placeholders', () => {
  const snapshot = emptySnapshot(1, 'Needs Refresh Pilot');

  assert.deepEqual(filterAssetSnapshots([snapshot], '', 'ships'), []);
  assert.deepEqual(filterAssetSnapshots([snapshot], 'needs', 'all'), []);
});

test('asset filters match rollup categories and recalculate visible aggregate summaries', () => {
  const matching = snapshotWithAssets(1, 'Matching Pilot', [
    { itemId: 1, typeId: 587, name: 'Rifter', groupId: 25, groupName: 'Frigate', categoryId: 6, categoryName: 'Ship', quantity: 1, singleton: true, locationId: 60003760, locationFlag: 'Hangar', locationType: 'station', unitValue: 1_000, pricingStatus: 'priced' },
    { itemId: 2, typeId: 34, name: 'Tritanium', groupId: 18, groupName: 'Mineral', categoryId: 4, categoryName: 'Material', quantity: 10, singleton: false, locationId: 60008494, locationFlag: 'Hangar', locationType: 'station', unitValue: 5, pricingStatus: 'priced' },
  ]);
  const nonMatching = snapshotWithAssets(2, 'Mineral Pilot', [
    { itemId: 3, typeId: 34, name: 'Tritanium', groupId: 18, groupName: 'Mineral', categoryId: 4, categoryName: 'Material', quantity: 1, singleton: false, locationId: 60008494, locationFlag: 'Hangar', locationType: 'station', unitValue: 5, pricingStatus: 'priced' },
  ]);

  const [filtered] = filterAssetSnapshots([matching, nonMatching], '', 'ships');

  assert.equal(filtered.pilot.characterName, 'Matching Pilot');
  assert.equal(filtered.pilot.locationCount, 1);
  assert.equal(filtered.pilot.itemCount, 1);
  assert.equal(filtered.pilot.stackCount, 1);
  assert.equal(filtered.pilot.totalValue, 1_000);
  assert.equal(filtered.locations.length, 1);
  assert.equal(filtered.locations[0].totalValue, 1_000);
  assert.equal(filtered.locations[0].assets[0].name, 'Rifter');

  const legacySnapshot = structuredClone(matching);
  delete (legacySnapshot.locations[0].assets[0] as Partial<typeof legacySnapshot.locations[0]['assets'][number]>).categoryRollups;
  assert.equal(filterAssetSnapshots([legacySnapshot], '', 'ships').length, 1);
});

test('rollup filters exclude a retained nonmatching container from summaries', () => {
  const snapshot = snapshotWithAssets(1, 'Container Pilot', [
    { itemId: 1, typeId: 1, name: 'Cargo Container', groupId: 1, groupName: 'Container', categoryId: 1, categoryName: 'Other', quantity: 1, singleton: true, locationId: 60003760, locationFlag: 'Hangar', locationType: 'station', unitValue: 100, pricingStatus: 'priced' },
    { itemId: 2, typeId: 587, name: 'Rifter', groupId: 25, groupName: 'Frigate', categoryId: 6, categoryName: 'Ship', quantity: 1, singleton: true, locationId: 1, locationFlag: 'Cargo', locationType: 'item', unitValue: 1_000, pricingStatus: 'priced' },
  ]);

  const [filtered] = filterAssetSnapshots([snapshot], '', 'ships');

  assert.equal(filtered.pilot.totalValue, 1_000);
  assert.equal(filtered.pilot.stackCount, 1);
  assert.equal(filtered.locations[0].assets[0].totalValue, 1_000);
  assert.equal(filtered.locations[0].assets[0].stackCount, 1);
});

test('pilot-name searches retain category-matching descendants and recompute totals', () => {
  const snapshot = snapshotWithAssets(1, 'Needle Pilot', [
    { itemId: 1, typeId: 1, name: 'Cargo Container', groupId: 1, groupName: 'Container', categoryId: 1, categoryName: 'Other', quantity: 1, singleton: true, locationId: 60003760, locationFlag: 'Hangar', locationType: 'station', unitValue: 100, pricingStatus: 'priced' },
    { itemId: 2, typeId: 587, name: 'Rifter', groupId: 25, groupName: 'Frigate', categoryId: 6, categoryName: 'Ship', quantity: 1, singleton: true, locationId: 1, locationFlag: 'Cargo', locationType: 'item', unitValue: 1_000, pricingStatus: 'priced' },
    { itemId: 3, typeId: 34, name: 'Tritanium', groupId: 18, groupName: 'Mineral', categoryId: 4, categoryName: 'Material', quantity: 1, singleton: false, locationId: 60008494, locationFlag: 'Hangar', locationType: 'station', unitValue: 5, pricingStatus: 'priced' },
  ]);

  const [filtered] = filterAssetSnapshots([snapshot], 'needle', 'ships');

  assert.equal(filtered.pilot.totalValue, 1_000);
  assert.equal(filtered.pilot.stackCount, 1);
  assert.equal(filtered.locations.length, 1);
  assert.equal(filtered.locations[0].assets[0].children[0].name, 'Rifter');
});

test('location-name searches retain category-matching descendants and recompute totals', () => {
  const snapshot = snapshotWithAssets(1, 'Location Pilot', [
    { itemId: 1, typeId: 1, name: 'Cargo Container', groupId: 1, groupName: 'Container', categoryId: 1, categoryName: 'Other', quantity: 1, singleton: true, locationId: 60003760, locationFlag: 'Hangar', locationType: 'station', unitValue: 100, pricingStatus: 'priced' },
    { itemId: 2, typeId: 587, name: 'Rifter', groupId: 25, groupName: 'Frigate', categoryId: 6, categoryName: 'Ship', quantity: 1, singleton: true, locationId: 1, locationFlag: 'Cargo', locationType: 'item', unitValue: 1_000, pricingStatus: 'priced' },
    { itemId: 3, typeId: 34, name: 'Tritanium', groupId: 18, groupName: 'Mineral', categoryId: 4, categoryName: 'Material', quantity: 1, singleton: false, locationId: 60008494, locationFlag: 'Hangar', locationType: 'station', unitValue: 5, pricingStatus: 'priced' },
  ]);

  const [filtered] = filterAssetSnapshots([snapshot], 'jita', 'ships');

  assert.equal(filtered.pilot.totalValue, 1_000);
  assert.equal(filtered.pilot.stackCount, 1);
  assert.equal(filtered.locations.length, 1);
  assert.equal(filtered.locations[0].assets[0].children[0].name, 'Rifter');
});

test('asset sort helper sorts pilots locations and nested assets without mutating input', () => {
  const alpha = snapshotWithAssets(1, 'Alpha Pilot', [
    { itemId: 1, typeId: 100, name: 'Zeta Container', groupId: 1, groupName: 'Container', categoryId: 1, categoryName: 'Other', quantity: 1, singleton: true, locationId: 60003760, locationFlag: 'Hangar', locationType: 'station', unitValue: 1, pricingStatus: 'priced' },
    { itemId: 2, typeId: 101, name: 'Acolyte II', groupId: 18, groupName: 'Drone', categoryId: 18, categoryName: 'Drone', quantity: 3, singleton: false, locationId: 1, locationFlag: 'Cargo', locationType: 'item', unitValue: 2, pricingStatus: 'priced' },
    { itemId: 3, typeId: 102, name: 'Barrage XL', groupId: 83, groupName: 'Projectile Ammo', categoryId: 8, categoryName: 'Charge', quantity: 50, singleton: false, locationId: 1, locationFlag: 'Cargo', locationType: 'item', unitValue: null, pricingStatus: 'unpriced' },
    { itemId: 4, typeId: 103, name: 'Mjolnir Torpedo', groupId: 83, groupName: 'Missile', categoryId: 8, categoryName: 'Charge', quantity: 10, singleton: false, locationId: 60008494, locationFlag: 'Hangar', locationType: 'station', unitValue: 4, pricingStatus: 'priced' },
  ]);
  const beta = snapshotWithAssets(2, 'Beta Pilot', [
    { itemId: 5, typeId: 104, name: 'Rifter', groupId: 25, groupName: 'Frigate', categoryId: 6, categoryName: 'Ship', quantity: 1, singleton: true, locationId: 60008494, locationFlag: 'Hangar', locationType: 'station', unitValue: 100, pricingStatus: 'priced' },
  ]);
  const originalFirstLocation = alpha.locations[0].name;

  const sorted = sortAssetSnapshots([alpha, beta], { column: 'totalValue', direction: 'desc' });

  assert.deepEqual(sorted.map(snapshot => snapshot.pilot.characterName), ['Beta Pilot', 'Alpha Pilot']);
  assert.deepEqual(sorted[1].locations.map(location => location.name), ['Amarr', 'Jita']);
  assert.deepEqual(sorted[1].locations[1].assets[0].children.map(asset => asset.name), ['Acolyte II', 'Barrage XL']);
  assert.equal(alpha.locations[0].name, originalFirstLocation);
  assert.notEqual(sorted[1], alpha);
});

test('assets view is wired into navigation between fits and market', () => {
  const app = readFileSync(resolve('web/src/App.tsx'), 'utf8');
  const panel = readFileSync(resolve('web/src/components/ControlPanel.tsx'), 'utf8');

  assert.match(app, /import \{ AssetsView \}/);
  assert.match(app, /view === 'assets'/);
  assert.match(panel, /type View = .*'assets'/s);
  assert.match(panel, />Fits<\/button>[\s\S]*view === 'assets'[\s\S]*>Assets<\/button>[\s\S]*>Market<\/button>/);
  assert.match(panel, />Market<\/button>[\s\S]*>Contracts<\/button>[\s\S]*>Industry<\/button>/);
});

test('assets api helpers and component expose dashboard refresh search and expandable tree controls', () => {
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');
  const view = readFileSync(resolve('web/src/components/AssetsView.tsx'), 'utf8');

  assert.match(api, /export interface AssetDashboard/);
  assert.match(api, /export interface AssetDashboard extends AssetValueSummary \{[\s\S]*pilots: AssetPilotSummary\[\];/);
  assert.match(api, /export async function fetchAssets/);
  assert.match(api, /export async function refreshAllAssets/);
  assert.match(api, /export async function refreshPilotAssets/);

  assert.match(view, /Refresh All/);
  assert.match(view, /Search assets/);
  assert.match(view, /sortAssetSnapshots\(filtered, sort\)/);
  assert.match(view, /ASSET_SORT_COLUMNS\.map/);
  assert.match(view, /aria-sort=\{sort\.column === column/);
  assert.match(view, /asset-pilot-avatar/);
  assert.match(view, /images\.evetech\.net\/characters\/\$\{id\}\/portrait\?size=32/);
  assert.match(view, /Asset access needs EVE re-auth/);
  assert.match(view, /Missing asset scope/);
  assert.match(view, /All assets/);
  assert.match(view, /expandedPilots/);
  assert.match(view, /expandedLocations/);
  assert.match(view, /expandedAssets/);
  assert.match(view, /refreshInFlight\.current/);
  assert.match(view, /setPilots\(result\.pilots\)/);
  assert.match(view, /const requestGeneration = useRef\(0\)/);
  assert.match(view, /const generation = \+\+requestGeneration\.current/);
  assert.match(view, /generation !== requestGeneration\.current/);
  assert.match(view, /const refreshDisabled = busy != null \|\| loadState === 'loading'/);
  assert.match(view, /disabled=\{refreshDisabled\}/);
  assert.match(view, /refreshDisabled=\{refreshDisabled\}/);
  assert.match(view, /loadState === 'loading'/);
  assert.match(view, /loadState === 'error'/);
  assert.match(view, /assets-tree-content/);
});

test('assets layout allows expanded asset rows to scroll vertically', () => {
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(styles, /\.assets-view\s*\{[\s\S]*min-height:\s*0;/);
  assert.match(styles, /\.assets-view\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(styles, /\.asset-pilot-row\s*\{[\s\S]*grid-template-columns:\s*20px 32px minmax\(200px, 1fr\)/);
  assert.match(styles, /\.asset-pilot-avatar\s*\{[\s\S]*width:\s*32px;/);
  assert.match(styles, /\.asset-sort-button\s*\{[\s\S]*cursor:\s*pointer;/);
  assert.match(styles, /\.asset-sort-indicator\s*\{[\s\S]*color:\s*var\(--accent\);/);
  assert.doesNotMatch(styles, /\.assets-tree\s*\{[^}]*overflow-y:\s*hidden;/);
});

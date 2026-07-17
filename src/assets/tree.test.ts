import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssetTree } from './tree.ts';
import type { RawAssetInput, RawAssetLocationInput } from './types.ts';

const locations: RawAssetLocationInput[] = [
  { locationId: 60003760, name: 'Jita IV - Moon 4', type: 'station', status: 'resolved' },
];

test('buildAssetTree nests contained assets and rolls values up without duplicating stack rows', () => {
  const assets: RawAssetInput[] = [
    {
      itemId: 1,
      typeId: 587,
      name: 'Rifter',
      groupId: 25,
      groupName: 'Frigate',
      categoryId: 6,
      categoryName: 'Ship',
      quantity: 1,
      singleton: true,
      locationId: 60003760,
      locationFlag: 'Hangar',
      locationType: 'station',
      unitValue: 1_000_000,
      pricingStatus: 'priced',
    },
    {
      itemId: 2,
      typeId: 34,
      name: 'Tritanium',
      groupId: 18,
      groupName: 'Mineral',
      categoryId: 4,
      categoryName: 'Material',
      quantity: 100,
      singleton: false,
      locationId: 1,
      locationFlag: 'Cargo',
      locationType: 'item',
      unitValue: 5,
      pricingStatus: 'priced',
    },
  ];

  const tree = buildAssetTree({
    characterId: 123,
    characterName: 'Asset Pilot',
    lastRefreshedAt: 1_700_000_000_000,
    status: 'Ready',
    error: null,
    locations,
    assets,
  });

  assert.equal(tree.pilot.totalValue, 1_000_500);
  assert.equal(tree.pilot.stackCount, 2);
  assert.equal(tree.locations[0].totalValue, 1_000_500);
  assert.equal(tree.locations[0].assets[0].children[0].name, 'Tritanium');
  assert.equal(tree.categories.find(c => c.key === 'frigates')?.totalValue, 1_000_000);
  assert.equal(tree.categories.find(c => c.key === 'ships')?.totalValue, 1_000_000);
  assert.equal(tree.categories.find(c => c.key === 'minerals')?.totalValue, 500);
});

test('buildAssetTree tracks unpriced stacks in aggregates', () => {
  const tree = buildAssetTree({
    characterId: 123,
    characterName: 'Asset Pilot',
    lastRefreshedAt: null,
    status: 'Needs refresh',
    error: null,
    locations,
    assets: [{
      itemId: 3,
      typeId: 999999,
      name: 'Mystery Thing',
      groupId: 0,
      groupName: 'Mystery',
      categoryId: 0,
      categoryName: 'Mystery',
      quantity: 1,
      singleton: false,
      locationId: 60003760,
      locationFlag: 'Hangar',
      locationType: 'station',
      unitValue: null,
      pricingStatus: 'unpriced',
    }],
  });

  assert.equal(tree.pilot.totalValue, 0);
  assert.equal(tree.pilot.unpricedStacks, 1);
  assert.equal(tree.categories.find(c => c.key === 'other')?.unpricedStacks, 1);
});

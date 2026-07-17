import assert from 'node:assert/strict';
import test from 'node:test';
import { categorizeAssetItem } from './categories.ts';

test('categorizeAssetItem maps broad v1 asset dashboard groups', () => {
  assert.equal(categorizeAssetItem({ typeId: 587, name: 'Rifter', groupId: 25, groupName: 'Frigate', categoryId: 6, categoryName: 'Ship' }).primary, 'frigates');
  assert.equal(categorizeAssetItem({ typeId: 24688, name: 'Rokh', groupId: 27, groupName: 'Battleship', categoryId: 6, categoryName: 'Ship' }).primary, 'battleships');
  assert.equal(categorizeAssetItem({ typeId: 19722, name: 'Naglfar', groupId: 485, groupName: 'Dreadnought', categoryId: 6, categoryName: 'Ship' }).primary, 'capitals');
  assert.equal(categorizeAssetItem({ typeId: 2048, name: 'Damage Control II', groupId: 60, groupName: 'Damage Control', categoryId: 7, categoryName: 'Module' }).primary, 'modules');
  assert.equal(categorizeAssetItem({ typeId: 31177, name: 'Small Gravity Capacitor Upgrade II', groupId: 773, groupName: 'Rig Scanning', categoryId: 7, categoryName: 'Module' }).primary, 'scanning');
  assert.equal(categorizeAssetItem({ typeId: 9942, name: 'Memory Augmentation - Basic', groupId: 300, groupName: 'Cyberimplant', categoryId: 20, categoryName: 'Implant' }).primary, 'implants');
  assert.equal(categorizeAssetItem({ typeId: 34, name: 'Tritanium', groupId: 18, groupName: 'Mineral', categoryId: 4, categoryName: 'Material' }).primary, 'minerals');
  assert.equal(categorizeAssetItem({ typeId: 999999, name: 'Mystery Thing', groupId: 0, groupName: 'Mystery', categoryId: 0, categoryName: 'Mystery' }).primary, 'other');
});

test('ship subcategories roll up to ships without changing primary category', () => {
  const category = categorizeAssetItem({ typeId: 587, name: 'Rifter', groupId: 25, groupName: 'Frigate', categoryId: 6, categoryName: 'Ship' });
  assert.equal(category.primary, 'frigates');
  assert.deepEqual(category.rollups, ['ships']);
});

test('categorizeAssetItem recognizes mining hulls with real Venture and Prospect metadata', () => {
  assert.equal(categorizeAssetItem({
    typeId: 32880,
    name: 'Venture',
    groupId: 25,
    groupName: 'Frigate',
    categoryId: 6,
    categoryName: 'Ship',
  }).primary, 'mining-ships');
  assert.equal(categorizeAssetItem({
    typeId: 33697,
    name: 'Prospect',
    groupId: 1283,
    groupName: 'Expedition Frigate',
    categoryId: 6,
    categoryName: 'Ship',
  }).primary, 'mining-ships');
});

test('categorizeAssetItem does not treat sensor boosters as shield modules', () => {
  assert.equal(categorizeAssetItem({
    typeId: 1952,
    name: 'Sensor Booster II',
    groupId: 212,
    groupName: 'Sensor Booster',
    categoryId: 7,
    categoryName: 'Module',
  }).primary, 'modules');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as SkillsView from '../web/src/components/SkillsView.tsx';
import type { SkillComparison, SkillComparisonPilot } from '../web/src/api.ts';

type SkillComparisonSort = {
  key: 'pilot' | 'active' | 'trained' | 'sp' | 'status';
  direction: 'asc' | 'desc';
};

function sortSkillComparisonPilots(pilots: SkillComparisonPilot[], sort: SkillComparisonSort) {
  const sorter = (SkillsView as unknown as {
    sortSkillComparisonPilots?: (rows: SkillComparisonPilot[], value: SkillComparisonSort) => SkillComparisonPilot[];
  }).sortSkillComparisonPilots;
  if (!sorter) assert.fail('SkillsView must expose the comparison-row sorter');
  return sorter(pilots, sort);
}

function nextSkillComparisonSort(current: SkillComparisonSort, key: SkillComparisonSort['key']) {
  const nextSort = (SkillsView as unknown as {
    nextSkillComparisonSort?: (value: SkillComparisonSort, nextKey: SkillComparisonSort['key']) => SkillComparisonSort;
  }).nextSkillComparisonSort;
  if (!nextSort) assert.fail('SkillsView must expose the comparison sort toggle');
  return nextSort(current, key);
}

function pilot(overrides: Partial<SkillComparisonPilot>): SkillComparisonPilot {
  return {
    characterId: 1,
    characterName: 'Alpha',
    activeSkillLevel: 0,
    trainedSkillLevel: 0,
    skillpointsInSkill: 0,
    skillsAvailable: true,
    ...overrides,
  };
}

const rows = [
  pilot({ characterId: 3, characterName: 'Charlie', activeSkillLevel: 3, trainedSkillLevel: 2, skillpointsInSkill: 30_000 }),
  pilot({ characterId: 2, characterName: 'Bravo', activeSkillLevel: 1, trainedSkillLevel: 4, skillpointsInSkill: 80_000 }),
  pilot({ characterId: 1, characterName: 'Alpha', activeSkillLevel: 5, trainedSkillLevel: 3, skillpointsInSkill: 50_000 }),
  pilot({
    characterId: 4,
    characterName: 'Delta',
    activeSkillLevel: null,
    trainedSkillLevel: null,
    skillpointsInSkill: null,
    skillsAvailable: false,
  }),
];

function names(sort: SkillComparisonSort): string[] {
  return sortSkillComparisonPilots(rows, sort).map(row => row.characterName);
}

test('pilot column sorts alphabetically in either direction', () => {
  assert.deepEqual(names({ key: 'pilot', direction: 'asc' }), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.deepEqual(names({ key: 'pilot', direction: 'desc' }), ['Delta', 'Charlie', 'Bravo', 'Alpha']);
});

test('active level column sorts numerically and leaves unpolled pilots last', () => {
  assert.deepEqual(names({ key: 'active', direction: 'asc' }), ['Bravo', 'Charlie', 'Alpha', 'Delta']);
  assert.deepEqual(names({ key: 'active', direction: 'desc' }), ['Alpha', 'Charlie', 'Bravo', 'Delta']);
});

test('trained level column sorts numerically and leaves unpolled pilots last', () => {
  assert.deepEqual(names({ key: 'trained', direction: 'asc' }), ['Charlie', 'Alpha', 'Bravo', 'Delta']);
  assert.deepEqual(names({ key: 'trained', direction: 'desc' }), ['Bravo', 'Alpha', 'Charlie', 'Delta']);
});

test('skill points column sorts numerically and leaves unpolled pilots last', () => {
  assert.deepEqual(names({ key: 'sp', direction: 'asc' }), ['Charlie', 'Alpha', 'Bravo', 'Delta']);
  assert.deepEqual(names({ key: 'sp', direction: 'desc' }), ['Bravo', 'Alpha', 'Charlie', 'Delta']);
});

test('status column sorts by displayed status and leaves unpolled pilots last', () => {
  const statusRows = [
    pilot({ characterId: 3, characterName: 'Charlie', trainedSkillLevel: 3 }),
    pilot({ characterId: 2, characterName: 'Bravo', trainedSkillLevel: 0 }),
    pilot({ characterId: 1, characterName: 'Alpha', trainedSkillLevel: 0 }),
    pilot({ characterId: 4, characterName: 'Delta', trainedSkillLevel: null, skillsAvailable: false }),
  ];

  assert.deepEqual(
    sortSkillComparisonPilots(statusRows, { key: 'status', direction: 'asc' }).map(row => row.characterName),
    ['Alpha', 'Bravo', 'Charlie', 'Delta'],
  );
  assert.deepEqual(
    sortSkillComparisonPilots(statusRows, { key: 'status', direction: 'desc' }).map(row => row.characterName),
    ['Charlie', 'Alpha', 'Bravo', 'Delta'],
  );
});

test('clicking the active column reverses it while a new column starts ascending', () => {
  assert.deepEqual(
    nextSkillComparisonSort({ key: 'pilot', direction: 'asc' }, 'pilot'),
    { key: 'pilot', direction: 'desc' },
  );
  assert.deepEqual(
    nextSkillComparisonSort({ key: 'pilot', direction: 'desc' }, 'sp'),
    { key: 'sp', direction: 'asc' },
  );
});

test('sorting never mutates the API response rows', () => {
  const before = rows.map(row => row.characterName);

  sortSkillComparisonPilots(rows, { key: 'trained', direction: 'desc' });

  assert.deepEqual(rows.map(row => row.characterName), before);
});

test('comparison results render every column as an accessible sort control', () => {
  const Panel = (SkillsView as unknown as {
    SkillComparisonPanel?: ComponentType<{
      query: string;
      comparison: SkillComparison | null;
      loading: boolean;
      error: string | null;
    }>;
  }).SkillComparisonPanel;
  if (!Panel) assert.fail('SkillsView must expose the rendered comparison panel');

  const comparison: SkillComparison = {
    query: 'navigation',
    pilotCount: 1,
    cachedPilotCount: 1,
    matches: [{
      skillId: 3449,
      name: 'Navigation',
      groupId: 257,
      groupName: 'Navigation',
      rank: 1,
      pilots: [pilot({ characterName: 'Alpha', trainedSkillLevel: 5 })],
    }],
  };
  const html = renderToStaticMarkup(createElement(Panel, {
    query: 'navigation',
    comparison,
    loading: false,
    error: null,
  }));

  assert.equal((html.match(/role="columnheader"/g) ?? []).length, 5);
  for (const label of ['Pilot', 'Active', 'Trained', 'SP', 'Status']) {
    assert.match(html, new RegExp(`aria-label="Sort by ${label}"`));
  }
  assert.match(html, /role="columnheader" aria-sort="ascending"[\s\S]*?aria-label="Sort by Pilot"/);
  assert.equal((html.match(/aria-sort="none"/g) ?? []).length, 4);
});

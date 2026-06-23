# Industry Manufacturing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Industry tab that searches EVE manufacturing blueprints and quotes materials, duration, and required skill gaps for either Max skills or a real OAuth pilot.

**Architecture:** Extend the existing SDE bundling path so runtime industry lookups are local and instant. Add pure calculator functions with tests, expose them through Fastify routes, then add a dense React Industry view matching the existing operational app style.

**Tech Stack:** TypeScript, Fastify, React+Vite, better-sqlite3, bundled CCP SDE YAML via `js-yaml`, Node built-in test runner with `tsx`.

## Global Constraints

- V1 is manufacturing only.
- Include `Max skills` virtual pilot plus real OAuth pilots.
- Inputs: blueprint search, pilot, runs, ME, TE.
- Outputs: product, materials, duration, required skills, SP gaps.
- Exclude structure rig bonuses, facility bonuses, system cost index, job install fees, invention, reactions, copy/research from v1.
- Preserve the existing dark, dense, scan-friendly dashboard style.
- Do not add a market-profit calculator in this task.

---

### Task 1: Add Pure Industry Calculator and Tests

**Files:**
- Create: `src/industry/calculator.ts`
- Create: `src/industry/calculator.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `skillPointsForLevel(rank: number, level: number): number`
  - `calculateIndustryQuote(input: IndustryQuoteInput): IndustryQuote`
  - `IndustryBlueprint`, `IndustryPilotSkills`, `IndustryQuote` types
- Consumes: no app-specific state; pure data only.

- [ ] **Step 1: Add test script**

Modify `package.json` scripts:

```json
"test": "node --import tsx --test \"src/**/*.test.ts\""
```

- [ ] **Step 2: Write failing calculator tests**

Create `src/industry/calculator.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateIndustryQuote, skillPointsForLevel, type IndustryBlueprint } from './calculator.ts';

const rifter: IndustryBlueprint = {
  blueprintId: 691,
  blueprintName: 'Rifter Blueprint',
  productTypeId: 587,
  productName: 'Rifter',
  productQuantity: 1,
  baseTimeSeconds: 6000,
  materials: [
    { typeId: 34, name: 'Tritanium', quantity: 32000 },
    { typeId: 35, name: 'Pyerite', quantity: 6000 },
  ],
  requiredSkills: [
    { skillId: 3380, name: 'Industry', level: 1, rank: 1 },
  ],
};

test('skillPointsForLevel matches EVE rank-based thresholds', () => {
  assert.equal(skillPointsForLevel(1, 0), 0);
  assert.equal(skillPointsForLevel(1, 1), 250);
  assert.equal(skillPointsForLevel(1, 5), 256000);
  assert.equal(skillPointsForLevel(2, 5), 512000);
});

test('calculateIndustryQuote applies ME to total material quantity and rounds up', () => {
  const quote = calculateIndustryQuote({
    blueprint: rifter,
    runs: 3,
    me: 10,
    te: 0,
    pilot: {
      kind: 'max',
      skillLevels: new Map([[3380, 5], [3388, 5]]),
      skillpoints: new Map(),
    },
  });

  assert.equal(quote.materials[0].baseQuantity, 96000);
  assert.equal(quote.materials[0].adjustedQuantity, 86400);
  assert.equal(quote.materials[1].baseQuantity, 18000);
  assert.equal(quote.materials[1].adjustedQuantity, 16200);
});

test('calculateIndustryQuote applies TE plus Industry and Advanced Industry time reductions', () => {
  const quote = calculateIndustryQuote({
    blueprint: rifter,
    runs: 2,
    me: 0,
    te: 20,
    pilot: {
      kind: 'max',
      skillLevels: new Map([[3380, 5], [3388, 5]]),
      skillpoints: new Map(),
    },
  });

  assert.equal(quote.time.perRunSeconds, Math.ceil(6000 * 0.8 * 0.8 * 0.85));
  assert.equal(quote.time.adjustedSeconds, Math.ceil(6000 * 0.8 * 0.8 * 0.85) * 2);
});

test('calculateIndustryQuote reports skill gaps for real pilots', () => {
  const quote = calculateIndustryQuote({
    blueprint: rifter,
    runs: 1,
    me: 0,
    te: 0,
    pilot: {
      kind: 'character',
      skillLevels: new Map([[3380, 0], [3388, 0]]),
      skillpoints: new Map([[3380, 0]]),
    },
  });

  assert.equal(quote.skills[0].skillId, 3380);
  assert.equal(quote.skills[0].requiredLevel, 1);
  assert.equal(quote.skills[0].currentLevel, 0);
  assert.equal(quote.skills[0].spGap, 250);
  assert.equal(quote.totals.totalSpGap, 250);
  assert.equal(quote.totals.missingSkills, 1);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- src/industry/calculator.test.ts
```

Expected: fail because `src/industry/calculator.ts` does not exist.

- [ ] **Step 4: Implement calculator**

Create `src/industry/calculator.ts`:

```ts
export interface IndustryMaterial {
  typeId: number;
  name: string;
  quantity: number;
}

export interface IndustryRequiredSkill {
  skillId: number;
  name: string;
  level: number;
  rank: number;
}

export interface IndustryBlueprint {
  blueprintId: number;
  blueprintName: string;
  productTypeId: number;
  productName: string;
  productQuantity: number;
  baseTimeSeconds: number;
  materials: IndustryMaterial[];
  requiredSkills: IndustryRequiredSkill[];
}

export interface IndustryPilotSkills {
  kind: 'max' | 'character';
  skillLevels: Map<number, number>;
  skillpoints: Map<number, number>;
}

export interface IndustryQuoteInput {
  blueprint: IndustryBlueprint;
  runs: number;
  me: number;
  te: number;
  pilot: IndustryPilotSkills;
}

export interface IndustryQuote {
  blueprint: {
    blueprintId: number;
    blueprintName: string;
    productTypeId: number;
    productName: string;
    productQuantity: number;
  };
  inputs: { runs: number; me: number; te: number; characterId: 'max' | number };
  output: { typeId: number; name: string; quantity: number };
  time: { baseSeconds: number; adjustedSeconds: number; perRunSeconds: number };
  materials: Array<{ typeId: number; name: string; baseQuantity: number; adjustedQuantity: number }>;
  skills: Array<{
    skillId: number;
    name: string;
    rank: number;
    requiredLevel: number;
    currentLevel: number;
    currentSp: number;
    targetSp: number;
    spGap: number;
    met: boolean;
  }>;
  totals: { totalSpGap: number; missingSkills: number; totalSkills: number };
}

const INDUSTRY_SKILL_ID = 3380;
const ADVANCED_INDUSTRY_SKILL_ID = 3388;

export function skillPointsForLevel(rank: number, level: number): number {
  if (level <= 0) return 0;
  return Math.ceil(250 * rank * Math.pow(32, (level - 1) / 2));
}

export function calculateIndustryQuote(input: IndustryQuoteInput): IndustryQuote {
  const { blueprint, runs, me, te, pilot } = input;
  const industryLevel = pilot.kind === 'max' ? 5 : (pilot.skillLevels.get(INDUSTRY_SKILL_ID) ?? 0);
  const advancedIndustryLevel = pilot.kind === 'max' ? 5 : (pilot.skillLevels.get(ADVANCED_INDUSTRY_SKILL_ID) ?? 0);
  const perRunSeconds = Math.ceil(
    blueprint.baseTimeSeconds *
      (1 - te / 100) *
      (1 - industryLevel * 0.04) *
      (1 - advancedIndustryLevel * 0.03),
  );

  const skills = blueprint.requiredSkills.map(skill => {
    const currentLevel = pilot.kind === 'max' ? 5 : (pilot.skillLevels.get(skill.skillId) ?? 0);
    const currentSp = pilot.kind === 'max'
      ? skillPointsForLevel(skill.rank, 5)
      : (pilot.skillpoints.get(skill.skillId) ?? skillPointsForLevel(skill.rank, currentLevel));
    const targetSp = skillPointsForLevel(skill.rank, skill.level);
    const spGap = Math.max(0, targetSp - currentSp);
    return {
      skillId: skill.skillId,
      name: skill.name,
      rank: skill.rank,
      requiredLevel: skill.level,
      currentLevel,
      currentSp,
      targetSp,
      spGap,
      met: currentLevel >= skill.level,
    };
  }).sort((a, b) => Number(a.met) - Number(b.met) || b.spGap - a.spGap || a.name.localeCompare(b.name));

  return {
    blueprint: {
      blueprintId: blueprint.blueprintId,
      blueprintName: blueprint.blueprintName,
      productTypeId: blueprint.productTypeId,
      productName: blueprint.productName,
      productQuantity: blueprint.productQuantity,
    },
    inputs: { runs, me, te, characterId: pilot.kind === 'max' ? 'max' : 0 },
    output: {
      typeId: blueprint.productTypeId,
      name: blueprint.productName,
      quantity: blueprint.productQuantity * runs,
    },
    time: {
      baseSeconds: blueprint.baseTimeSeconds * runs,
      perRunSeconds,
      adjustedSeconds: perRunSeconds * runs,
    },
    materials: blueprint.materials.map(material => ({
      typeId: material.typeId,
      name: material.name,
      baseQuantity: material.quantity * runs,
      adjustedQuantity: Math.max(1, Math.ceil(material.quantity * runs * (1 - me / 100))),
    })),
    skills,
    totals: {
      totalSpGap: skills.reduce((n, s) => n + s.spGap, 0),
      missingSkills: skills.filter(s => !s.met).length,
      totalSkills: skills.length,
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
npm test -- src/industry/calculator.test.ts
```

Expected: all calculator tests pass.

---

### Task 2: Bundle Manufacturing Blueprints from the SDE

**Files:**
- Modify: `scripts/build-mastery-data.ts`
- Modify: `src/skills/mastery-data.ts`
- Generated: `data/eve-mastery.json`

**Interfaces:**
- Consumes: `IndustryBlueprint` shape from Task 1.
- Produces: `MasteryData.industry.blueprints`.

- [ ] **Step 1: Write failing data-shape smoke test**

Create `src/industry/data.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMasteryData } from '../skills/mastery-data.ts';

test('bundled industry data includes manufacturing blueprints', () => {
  const data = loadMasteryData();
  const rifter = data.industry?.blueprints['691'];
  assert.ok(rifter);
  assert.equal(rifter.blueprintName, 'Rifter Blueprint');
  assert.equal(rifter.productName, 'Rifter');
  assert.equal(rifter.baseTimeSeconds, 6000);
  assert.ok(rifter.materials.some(m => m.name === 'Tritanium' && m.quantity === 32000));
  assert.ok(rifter.requiredSkills.some(s => s.name === 'Industry' && s.level === 1));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/industry/data.test.ts
```

Expected: fail because `industry` is not present in bundled data/types.

- [ ] **Step 3: Extend `MasteryData` types**

Modify `src/skills/mastery-data.ts`:

```ts
export interface IndustryBlueprintData {
  blueprintId: number;
  blueprintName: string;
  productTypeId: number;
  productName: string;
  productQuantity: number;
  baseTimeSeconds: number;
  materials: Array<{ typeId: number; name: string; quantity: number }>;
  requiredSkills: Array<{ skillId: number; name: string; level: number; rank: number }>;
}

export interface MasteryData {
  // existing fields...
  industry?: {
    blueprints: Record<string, IndustryBlueprintData>;
  };
}
```

- [ ] **Step 4: Extend build script**

In `scripts/build-mastery-data.ts`:
- Load `fsd/blueprints.yaml`.
- For each blueprint with `activities.manufacturing`, include the first published product.
- Resolve blueprint/product/material/skill names from `types.yaml`.
- Resolve skill rank from `typeDogma.yaml`.
- Add `industry: { blueprints }` to the emitted JSON.
- Update `_meta.counts.industryBlueprints`.

- [ ] **Step 5: Rebuild data and verify test passes**

Run:

```bash
npm run build:mastery
npm test -- src/industry/data.test.ts
```

Expected: industry data includes Rifter Blueprint and tests pass.

---

### Task 3: Add Industry Backend Routes

**Files:**
- Create: `src/routes/industry.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `loadMasteryData()`, `calculateIndustryQuote()`, `getCachedSkills()`.
- Produces:
  - `GET /api/industry/blueprints?q=...`
  - `GET /api/industry/quote?blueprintId=...&characterId=max|id&runs=...&me=...&te=...`

- [ ] **Step 1: Write route implementation**

Create `src/routes/industry.ts` with:
- zod query validation.
- `searchBlueprints(query)` prefix-then-substring search.
- real pilot skill mapping from `getCachedSkills(characterId)`.
- `max` virtual pilot skill map.

- [ ] **Step 2: Register routes**

Modify `src/server.ts`:

```ts
import { registerIndustryRoutes } from './routes/industry.ts';
// ...
registerIndustryRoutes(app);
```

- [ ] **Step 3: Smoke test route behavior**

Run with dev server active:

```bash
curl -s 'http://127.0.0.1:3100/api/industry/blueprints?q=rifter'
curl -s 'http://127.0.0.1:3100/api/industry/quote?blueprintId=691&characterId=max&runs=1&me=0&te=0'
```

Expected:
- Search returns Rifter Blueprint.
- Quote returns Rifter output, materials, time, and met skills.

---

### Task 4: Add Industry Frontend API and View

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/components/IndustryView.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/ControlPanel.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes:
  - `searchIndustryBlueprints(q)`
  - `fetchIndustryQuote(params)`
  - `CharacterStatus[]`
- Produces:
  - `IndustryView({ chars })`

- [ ] **Step 1: Add API client types and functions**

In `web/src/api.ts`, add:

```ts
export interface IndustryBlueprintHit {
  blueprintId: number;
  blueprintName: string;
  productTypeId: number;
  productName: string;
  productQuantity: number;
}

export interface IndustryQuote { /* match backend response */ }

export async function searchIndustryBlueprints(q: string): Promise<IndustryBlueprintHit[]> { /* fetch */ }
export async function fetchIndustryQuote(params: {
  blueprintId: number;
  characterId: 'max' | number;
  runs: number;
  me: number;
  te: number;
}): Promise<IndustryQuote> { /* fetch */ }
```

- [ ] **Step 2: Build `IndustryView`**

Create `web/src/components/IndustryView.tsx`:
- `Max skills` option first in pilot selector.
- Blueprint search with autocomplete.
- Runs/ME/TE compact inputs.
- Quote fetch on selected blueprint or input changes.
- Summary strip, materials table, skills table.
- Empty/error/loading states.

- [ ] **Step 3: Wire top-level tab**

Modify `web/src/App.tsx`:
- Add `'industry'` to `View`.
- Import `IndustryView`.
- Render `{view === 'industry' && <IndustryView chars={list} />}`.

Modify `web/src/components/ControlPanel.tsx`:
- Add `'industry'` to view union.
- Add sixth nav button.
- Update nav CSS class if needed.

- [ ] **Step 4: Add CSS**

Modify `web/src/styles.css`:
- Add `.industry-view`, `.industry-controls`, `.industry-summary`, `.industry-grid`, `.industry-table`, `.industry-status`.
- Use existing variables and compact dense rows.

- [ ] **Step 5: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: passes.

---

### Task 5: Manual Verification and Memory Update

**Files:**
- Modify: `README.md`
- Modify: `/Users/cyrdax/.claude/projects/-Users-cyrdax/memory/project_eve_fleet_dashboard.md`

**Interfaces:**
- Produces updated docs/memory for future sessions.

- [ ] **Step 1: Start local app**

Run:

```bash
npm run dev
```

Expected:
- API listens on `127.0.0.1:3100`.
- Vite listens on `localhost:5173`.

- [ ] **Step 2: Manual checks**

In browser:
- Open Industry tab.
- Search `Rifter Blueprint`.
- Select `Max skills`.
- Confirm Rifter output, material rows, adjusted duration.
- Change runs from 1 to 10.
- Change ME from 0 to 10.
- Change TE from 0 to 20.
- Select a real pilot and confirm skill gaps render.

- [ ] **Step 3: Update README and memory**

Update README feature list with Industry tab.

Update project memory with:
- Industry tab v1 manufacturing-only.
- SDE files used.
- Routes.
- Max skills virtual pilot.
- V2 planned expansion: structure/facility/cost index/fees/invention/reactions/copy/research.

- [ ] **Step 4: Final verification**

Run:

```bash
npm test
npm run typecheck
```

Expected: all tests and typecheck pass.

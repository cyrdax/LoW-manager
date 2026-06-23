# Industry Manufacturing Tab Design

## Goal

Add an Industry tab that lets the user search EVE manufacturing blueprints, choose either a real OAuth pilot or a virtual Max skills pilot, and estimate manufacturing materials, duration, and missing skill training.

## Scope

Version 1 covers manufacturing only.

Included:
- Search published manufacturing blueprints from the bundled SDE data.
- Select a blueprint and calculate output, materials, job duration, and required skills.
- Select `Max skills` or one OAuth pilot.
- For real pilots, compare manufacturing skill requirements against the existing skill cache and show SP gaps.
- For `Max skills`, treat all blueprint requirements as met and use level V for manufacturing time skills.
- Support runs, blueprint material efficiency (ME), and blueprint time efficiency (TE).

Excluded from v1:
- Structure rig bonuses.
- Facility bonuses.
- System cost index.
- Job install fees and taxes.
- Invention.
- Reactions.
- Copying, material research, and time research.
- Market pricing, profitability, hauling, or sell-order math.

## Follow-Up Scope

Version 2 should expand the same Industry tab rather than introduce a separate tool. The v2 model should add an advanced calculation panel with:
- Facility selection: NPC station, player structure, and structure type.
- Structure rig bonus inputs, with prefilled common rig profiles where practical.
- Facility bonuses where CCP exposes or static data supports them.
- System cost index input or API-backed system lookup if a reliable source is added.
- Job install fee estimate based on adjusted job value and cost index.
- Blueprint copy, ME research, TE research, invention, and reaction activity modes from `blueprints.yaml.activities`.
- Invention-specific inputs: decryptor, datacore costs, outcome probability, runs, ME/TE output modifiers, and expected-cost-per-success.

The v2 work should reuse the v1 blueprint data model by adding activity-specific blocks instead of replacing the v1 manufacturing block.

## Data Source

Extend `scripts/build-mastery-data.ts`, which already downloads and caches the CCP SDE ZIP, to include a compact `industry` section in `data/eve-mastery.json`.

Source files:
- `fsd/blueprints.yaml`: blueprint activities, manufacturing time, materials, products, and required skills.
- `fsd/types.yaml`: blueprint/product/material/skill names and published flags.
- `fsd/typeDogma.yaml`: skill rank and primary/secondary attributes already used by the Skills tab.

Runtime JSON shape:

```ts
interface IndustryBlueprint {
  blueprintId: number;
  blueprintName: string;
  productTypeId: number;
  productName: string;
  productQuantity: number;
  baseTimeSeconds: number;
  materials: Array<{ typeId: number; name: string; quantity: number }>;
  requiredSkills: Array<{ skillId: number; name: string; level: number; rank: number }>;
}

interface MasteryData {
  industry?: {
    blueprints: Record<string, IndustryBlueprint>;
  };
}
```

Only published blueprints with a manufacturing activity and at least one published product should be included.

## Backend

Create `src/routes/industry.ts` and register it in `src/server.ts`.

Routes:

`GET /api/industry/blueprints?q=<query>`
- Returns up to 25 matching blueprints.
- Prefix matches rank above substring matches.
- Response rows include `blueprintId`, `blueprintName`, `productTypeId`, `productName`, and `productQuantity`.

`GET /api/industry/quote?blueprintId=<id>&characterId=max|<id>&runs=<n>&me=<0-10>&te=<0-20>`
- Validates `runs` as 1-1,000,000.
- Validates ME as 0-10.
- Validates TE as 0-20.
- Loads the selected blueprint from bundled data.
- Loads real pilot skills through the existing `getCachedSkills(characterId)` path used by the Skills tab.
- For `characterId=max`, treats every required skill as current level 5.

Quote response:

```ts
interface IndustryQuote {
  blueprint: {
    blueprintId: number;
    blueprintName: string;
    productTypeId: number;
    productName: string;
    productQuantity: number;
  };
  inputs: { runs: number; me: number; te: number; characterId: 'max' | number };
  output: { typeId: number; name: string; quantity: number };
  time: {
    baseSeconds: number;
    adjustedSeconds: number;
    perRunSeconds: number;
  };
  materials: Array<{
    typeId: number;
    name: string;
    baseQuantity: number;
    adjustedQuantity: number;
  }>;
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
  totals: {
    totalSpGap: number;
    missingSkills: number;
    totalSkills: number;
  };
}
```

## Calculations

Material quantity:
- Start from SDE manufacturing material quantity.
- Apply blueprint ME as a reduction percentage.
- Multiply by runs.
- Round up per material line.
- Minimum quantity is 1 when the base material quantity is greater than 0.

Formula:

```ts
adjustedQuantity = Math.max(1, Math.ceil(baseQuantity * runs * (1 - me / 100)));
```

Time:
- Start from SDE manufacturing time.
- Apply blueprint TE as a reduction percentage.
- Apply pilot skills:
  - `Industry` reduces manufacturing time by 4% per level.
  - `Advanced Industry` reduces all industry job durations by 3% per level.
- `Max skills` uses level 5 for both skills.
- Real pilots use cached skill levels; missing skills count as 0.
- Round adjusted total seconds up.

Formula:

```ts
perRunSeconds =
  baseTimeSeconds *
  (1 - te / 100) *
  (1 - industryLevel * 0.04) *
  (1 - advancedIndustryLevel * 0.03);

adjustedSeconds = Math.ceil(perRunSeconds * runs);
```

SP gap:
- Reuse the existing Skills tab SP formula and skill cache logic.
- Required skills come from `blueprints.yaml.activities.manufacturing.skills`.
- Sort missing skills first, then by SP gap descending, then skill name.

## Frontend

Create `web/src/components/IndustryView.tsx`.

Wire it as a sixth top-level view:
- Extend `View` in `web/src/App.tsx` to include `'industry'`.
- Add `<IndustryView chars={list} />`.
- Update `ControlPanel` view union and nav to include `Industry`.

Layout:
- Top controls row:
  - Pilot selector: `Max skills` first, then real pilots.
  - Blueprint search textbox.
  - Runs numeric input.
  - ME stepper/input.
  - TE stepper/input.
- Quote summary band:
  - Product output.
  - Total time.
  - Missing skill count.
  - Total SP gap.
- Materials table:
  - Material name.
  - Base quantity for selected runs.
  - Adjusted quantity after ME.
- Skills table:
  - Skill name.
  - Current level.
  - Required level.
  - SP gap.
  - Status.

Design style:
- Match the existing operational app style: dense, scan-friendly, dark UI.
- Do not make this a landing page or explanatory page.
- Use compact controls and stable column widths.
- Keep v2-only controls out of the initial UI; leave one small disabled/quiet note that advanced facility/job-cost modeling is planned for the next version.

## Error Handling

- Missing bundled industry data: backend returns 500 with `Run npm run build:mastery`.
- Blueprint not found: 404.
- Real pilot skills not yet polled: 409 with a message telling the user to wait for the skill poll.
- Invalid ME/TE/runs: 400 with exact validation message.
- Empty search: return `[]`.
- Blueprints without manufacturing activity never appear in search.

## Verification

Automated:
- Unit-test industry math:
  - ME rounds up material quantities.
  - TE and skills reduce time.
  - `Max skills` uses Industry V and Advanced Industry V.
  - Real pilot missing skills produce SP gaps.
- Route-test quote validation and blueprint search ranking if the repo has a lightweight backend test pattern. If not, add pure-function tests around the calculator and smoke-test routes manually.

Manual:
- Search `Rifter Blueprint`, quote one run at ME 0 / TE 0 with Max skills.
- Search `Covetor Blueprint`, select a real pilot, confirm required Industry skill display.
- Change runs from 1 to 10 and confirm materials scale.
- Change ME from 0 to 10 and confirm materials decrease.
- Change TE from 0 to 20 and confirm duration decreases.
- Select a pilot with missing skills and confirm SP gap appears.

## Open Decisions

No blocking decisions remain for v1.

The v2 expansion should be designed after v1 is usable, because structure/facility/system-cost modeling will add more inputs and needs a careful UI shape.

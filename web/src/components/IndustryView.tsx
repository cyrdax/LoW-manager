import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  fetchIndustryPlan,
  fetchIndustryQuote,
  searchSystems,
  searchIndustryBlueprints,
  type CharacterStatus,
  type IndustryBlueprintHit,
  type IndustryPlan,
  type IndustryPlanBonuses,
  type IndustryQuote,
  type SystemHit,
} from '../api.ts';

interface Props { chars: CharacterStatus[] }

type PilotChoice = 'max' | number;

const DECRYPTORS = [
  ['none', 'No decryptor'],
  ['accelerant', 'Accelerant'],
  ['attainment', 'Attainment'],
  ['augmentation', 'Augmentation'],
  ['optimized-attainment', 'Optimized Attainment'],
  ['optimized-augmentation', 'Optimized Augmentation'],
  ['parity', 'Parity'],
  ['process', 'Process'],
  ['symmetry', 'Symmetry'],
] as const;

const DEFAULT_BONUSES: IndustryPlanBonuses = {
  manufacturingTimeBonus: 0,
  manufacturingMaterialBonus: 0,
  inventionTimeBonus: 0,
  copyingTimeBonus: 0,
  reactionTimeBonus: 0,
  reactionMaterialBonus: 0,
  jobFeeBonus: 0,
  facilityTax: 0,
};

function formatQty(n: number): string {
  return n.toLocaleString();
}

function formatSp(sp: number): string {
  if (sp >= 1e9) return `${(sp / 1e9).toFixed(2)} B`;
  if (sp >= 1e6) return `${(sp / 1e6).toFixed(1)} M`;
  if (sp >= 1e3) return `${(sp / 1e3).toFixed(0)} K`;
  return String(sp);
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds <= 0) return '—';
  if (seconds < 60) return '<1m';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatIsk(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)} T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)} K`;
  return value.toLocaleString();
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function IndustryView({ chars }: Props) {
  const sortedChars = useMemo(() => [...chars].sort((a, b) => a.name.localeCompare(b.name)), [chars]);
  const [pilot, setPilot] = useState<PilotChoice>(() => {
    const raw = localStorage.getItem('efd.industry.pilot');
    if (!raw || raw === 'max') return 'max';
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 'max';
  });
  useEffect(() => { localStorage.setItem('efd.industry.pilot', String(pilot)); }, [pilot]);

  const [blueprint, setBlueprint] = useState<IndustryBlueprintHit | null>(null);
  const [runs, setRuns] = useState(1);
  const [me, setMe] = useState(0);
  const [te, setTe] = useState(0);
  const [quote, setQuote] = useState<IndustryQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestSeq = useRef(0);

  const [buildInputs, setBuildInputs] = useState(true);
  const [supportMe, setSupportMe] = useState(10);
  const [supportTe, setSupportTe] = useState(20);
  const [decryptor, setDecryptor] = useState('none');
  const [system, setSystem] = useState<SystemHit | null>(null);
  const [bonuses, setBonuses] = useState<IndustryPlanBonuses>(DEFAULT_BONUSES);
  const [plan, setPlan] = useState<IndustryPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const planSeq = useRef(0);

  useEffect(() => {
    if (!blueprint) {
      setQuote(null);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    fetchIndustryQuote({
      blueprintId: blueprint.blueprintId,
      characterId: pilot,
      runs,
      me,
      te,
    }).then(result => {
      if (seq !== requestSeq.current) return;
      if ('error' in result) {
        setQuote(null);
        setError(result.error);
      } else {
        setQuote(result);
      }
    }).catch(err => {
      if (seq === requestSeq.current) {
        setQuote(null);
        setError(err instanceof Error ? err.message : 'Failed to calculate quote');
      }
    }).finally(() => {
      if (seq === requestSeq.current) setLoading(false);
    });
  }, [blueprint, pilot, runs, me, te]);

  useEffect(() => {
    if (!blueprint) {
      setPlan(null);
      setPlanError(null);
      return;
    }

    const seq = ++planSeq.current;
    setPlanLoading(true);
    setPlanError(null);
    fetchIndustryPlan({
      blueprintId: blueprint.blueprintId,
      characterId: pilot,
      runs,
      systemId: system?.id ?? null,
      buildInputs,
      supportMe,
      supportTe,
      decryptor,
      bonuses,
    }).then(result => {
      if (seq !== planSeq.current) return;
      if ('error' in result) {
        setPlan(null);
        setPlanError(result.error);
      } else {
        setPlan(result);
      }
    }).catch(err => {
      if (seq === planSeq.current) {
        setPlan(null);
        setPlanError(err instanceof Error ? err.message : 'Failed to calculate build plan');
      }
    }).finally(() => {
      if (seq === planSeq.current) setPlanLoading(false);
    });
  }, [blueprint, pilot, runs, system, buildInputs, supportMe, supportTe, decryptor, bonuses]);

  const updateBonus = (key: keyof IndustryPlanBonuses, value: number) => {
    setBonuses(prev => ({ ...prev, [key]: clamp(value, 0, 100) }));
  };

  return (
    <main className="rows-wrap industry-view">
      <div className="ind-controls">
        <label className="ind-control">
          <span>Pilot</span>
          <select
            value={pilot}
            onChange={e => setPilot(e.target.value === 'max' ? 'max' : Number(e.target.value))}
          >
            <option value="max">Max skills</option>
            {sortedChars.map(c => (
              <option key={c.characterId} value={c.characterId}>
                {c.name}{c.corporationTicker ? ` [${c.corporationTicker}]` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="ind-control ind-blueprint">
          <span>Blueprint</span>
          <BlueprintSearch value={blueprint} onChange={setBlueprint} />
        </label>

        <label className="ind-control small">
          <span>Runs</span>
          <input
            type="number"
            min={1}
            max={1_000_000}
            value={runs}
            onChange={e => setRuns(clamp(Number(e.target.value), 1, 1_000_000))}
          />
        </label>

        <label className="ind-control small">
          <span>ME</span>
          <input
            type="number"
            min={0}
            max={10}
            value={me}
            onChange={e => setMe(clamp(Number(e.target.value), 0, 10))}
          />
        </label>

        <label className="ind-control small">
          <span>TE</span>
          <input
            type="number"
            min={0}
            max={20}
            value={te}
            onChange={e => setTe(clamp(Number(e.target.value), 0, 20))}
          />
        </label>
      </div>

      {!blueprint && (
        <div className="ind-empty">
          Search a manufacturing blueprint to calculate materials, duration, and pilot skill gaps.
        </div>
      )}
      {loading && <div className="ind-status">Calculating…</div>}
      {error && <div className="ind-status err">{error}</div>}
      {quote && <IndustryQuotePanel quote={quote} pilot={pilot} />}
      {blueprint && (
        <IndustryPlanControls
          system={system}
          onSystemChange={setSystem}
          buildInputs={buildInputs}
          onBuildInputsChange={setBuildInputs}
          supportMe={supportMe}
          supportTe={supportTe}
          onSupportMeChange={setSupportMe}
          onSupportTeChange={setSupportTe}
          decryptor={decryptor}
          onDecryptorChange={setDecryptor}
          bonuses={bonuses}
          onBonusChange={updateBonus}
        />
      )}
      {planLoading && <div className="ind-status">Planning build chain…</div>}
      {planError && <div className="ind-status err">{planError}</div>}
      {plan && <IndustryPlanPanel plan={plan} />}
    </main>
  );
}

function BlueprintSearch({
  value,
  onChange,
}: {
  value: IndustryBlueprintHit | null;
  onChange: (v: IndustryBlueprintHit | null) => void;
}) {
  const [query, setQuery] = useState(value?.blueprintName ?? '');
  const [hits, setHits] = useState<IndustryBlueprintHit[]>([]);
  const [active, setActive] = useState(-1);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { if (value && query !== value.blueprintName) setQuery(value.blueprintName); }, [value]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (abortRef.current) abortRef.current.abort();
    if (value && query === value.blueprintName) { setHits([]); return; }
    const ctl = new AbortController();
    abortRef.current = ctl;
    debounce.current = setTimeout(async () => {
      const r = await searchIndustryBlueprints(query, ctl.signal).catch(() => []);
      setHits(r);
      setActive(r.length > 0 ? 0 : -1);
    }, 120);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, value]);

  const pick = (h: IndustryBlueprintHit) => {
    onChange(h);
    setQuery(h.blueprintName);
    setHits([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(hits[active]); }
    else if (e.key === 'Escape') setHits([]);
  };

  return (
    <div className="ind-search">
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); if (value) onChange(null); }}
        onKeyDown={onKeyDown}
        placeholder="Rifter Blueprint"
      />
      {hits.length > 0 && (
        <div className="ind-suggest">
          {hits.map((h, i) => (
            <button
              key={h.blueprintId}
              className={i === active ? 'active' : ''}
              type="button"
              onMouseDown={e => { e.preventDefault(); pick(h); }}
            >
              <span>{h.blueprintName}</span>
              <small>{h.productQuantity.toLocaleString()} × {h.productName}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IndustryPlanControls({
  system,
  onSystemChange,
  buildInputs,
  onBuildInputsChange,
  supportMe,
  supportTe,
  onSupportMeChange,
  onSupportTeChange,
  decryptor,
  onDecryptorChange,
  bonuses,
  onBonusChange,
}: {
  system: SystemHit | null;
  onSystemChange: (system: SystemHit | null) => void;
  buildInputs: boolean;
  onBuildInputsChange: (value: boolean) => void;
  supportMe: number;
  supportTe: number;
  onSupportMeChange: (value: number) => void;
  onSupportTeChange: (value: number) => void;
  decryptor: string;
  onDecryptorChange: (value: string) => void;
  bonuses: IndustryPlanBonuses;
  onBonusChange: (key: keyof IndustryPlanBonuses, value: number) => void;
}) {
  return (
    <section className="ind-plan-controls">
      <div className="ind-plan-control-head">
        <h2>Build chain</h2>
        <label className="ind-check">
          <input type="checkbox" checked={buildInputs} onChange={e => onBuildInputsChange(e.target.checked)} />
          <span>Build inputs from blueprints</span>
        </label>
      </div>

      <div className="ind-plan-grid">
        <label className="ind-control">
          <span>Build system</span>
          <SystemSearch value={system} onChange={onSystemChange} />
        </label>
        <label className="ind-control">
          <span>Decryptor</span>
          <select value={decryptor} onChange={e => onDecryptorChange(e.target.value)}>
            {DECRYPTORS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="ind-control small">
          <span>Support ME</span>
          <input type="number" min={0} max={10} value={supportMe} onChange={e => onSupportMeChange(clamp(Number(e.target.value), 0, 10))} />
        </label>
        <label className="ind-control small">
          <span>Support TE</span>
          <input type="number" min={0} max={20} value={supportTe} onChange={e => onSupportTeChange(clamp(Number(e.target.value), 0, 20))} />
        </label>
      </div>

      <div className="ind-bonus-grid">
        <BonusInput label="Mfg time" value={bonuses.manufacturingTimeBonus} onChange={v => onBonusChange('manufacturingTimeBonus', v)} />
        <BonusInput label="Mfg material" value={bonuses.manufacturingMaterialBonus} onChange={v => onBonusChange('manufacturingMaterialBonus', v)} />
        <BonusInput label="Invention time" value={bonuses.inventionTimeBonus} onChange={v => onBonusChange('inventionTimeBonus', v)} />
        <BonusInput label="Copy time" value={bonuses.copyingTimeBonus} onChange={v => onBonusChange('copyingTimeBonus', v)} />
        <BonusInput label="Reaction time" value={bonuses.reactionTimeBonus} onChange={v => onBonusChange('reactionTimeBonus', v)} />
        <BonusInput label="Reaction material" value={bonuses.reactionMaterialBonus} onChange={v => onBonusChange('reactionMaterialBonus', v)} />
        <BonusInput label="Job fee" value={bonuses.jobFeeBonus} onChange={v => onBonusChange('jobFeeBonus', v)} />
        <BonusInput label="Facility tax" value={bonuses.facilityTax} onChange={v => onBonusChange('facilityTax', v)} />
      </div>
    </section>
  );
}

function BonusInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="ind-control small">
      <span>{label}</span>
      <input type="number" min={0} max={100} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}

function SystemSearch({ value, onChange }: { value: SystemHit | null; onChange: (value: SystemHit | null) => void }) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [hits, setHits] = useState<SystemHit[]>([]);
  const [active, setActive] = useState(-1);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { if (value && query !== value.name) setQuery(value.name); }, [value]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (abortRef.current) abortRef.current.abort();
    if (value && query === value.name) { setHits([]); return; }
    const ctl = new AbortController();
    abortRef.current = ctl;
    debounce.current = setTimeout(async () => {
      const r = await searchSystems(query, ctl.signal).catch(() => []);
      setHits(r);
      setActive(r.length > 0 ? 0 : -1);
    }, 120);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, value]);

  const pick = (hit: SystemHit) => {
    onChange(hit);
    setQuery(hit.name);
    setHits([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(hits[active]); }
    else if (e.key === 'Escape') setHits([]);
  };

  return (
    <div className="ind-search">
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); if (value) onChange(null); }}
        onKeyDown={onKeyDown}
        placeholder="Jita"
      />
      {hits.length > 0 && (
        <div className="ind-suggest">
          {hits.map((hit, i) => (
            <button
              key={hit.id}
              className={i === active ? 'active' : ''}
              type="button"
              onMouseDown={e => { e.preventDefault(); pick(hit); }}
            >
              <span>{hit.name}</span>
              <small>{hit.id}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IndustryQuotePanel({ quote, pilot }: { quote: IndustryQuote; pilot: PilotChoice }) {
  const missing = quote.totals.missingSkills;
  return (
    <section className="ind-quote">
      <div className="ind-summary">
        <div>
          <span className="label">Output</span>
          <strong>{formatQty(quote.output.quantity)} × {quote.output.name}</strong>
        </div>
        <div>
          <span className="label">Total time</span>
          <strong>{formatDuration(quote.time.adjustedSeconds)}</strong>
          <small>{formatDuration(quote.time.perRunSeconds)} / run</small>
        </div>
        <div>
          <span className="label">Materials</span>
          <strong>{quote.materials.length}</strong>
          <small>{quote.inputs.me}% ME</small>
        </div>
        <div className={missing > 0 ? 'warn' : 'ok'}>
          <span className="label">Skills</span>
          <strong>{missing > 0 ? `${missing} missing` : 'Ready'}</strong>
          <small>
            {pilot === 'max'
              ? 'Max skills'
              : `${formatSp(quote.totals.totalSpGap)} SP · ${formatDuration(quote.totals.totalTrainingSeconds)}`}
          </small>
        </div>
      </div>

      <div className="ind-two-col">
        <div className="ind-panel">
          <h2>Materials</h2>
          <div className="ind-table ind-materials">
            <div className="ind-head"><span>Material</span><span>Base</span><span>Adjusted</span></div>
            {quote.materials.map(m => (
              <div key={m.typeId} className="ind-row">
                <span>{m.name}</span>
                <span>{formatQty(m.baseQuantity)}</span>
                <span>{formatQty(m.adjustedQuantity)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="ind-panel">
          <h2>Required skills</h2>
          <div className="ind-table ind-skills">
            <div className="ind-head"><span>Skill</span><span>Current</span><span>Required</span><span>SP gap</span><span>Training</span></div>
            {quote.skills.length === 0 && <div className="ind-none">No manufacturing skills required.</div>}
            {quote.skills.map(s => (
              <div key={s.skillId} className={`ind-row${s.met ? ' met' : ' missing'}`}>
                <span>{s.name} <small>r{s.rank}</small></span>
                <span>{s.currentLevel}</span>
                <span>{s.requiredLevel}</span>
                <span>{s.spGap > 0 ? formatSp(s.spGap) : 'met'}</span>
                <span>{s.spGap > 0 ? formatDuration(s.trainingSeconds) : 'met'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ind-next-note">
        The build-chain planner below models invention, copy jobs, recursive input builds, system cost indexes, and manually entered structure / rig bonuses.
      </div>
    </section>
  );
}

function IndustryPlanPanel({ plan }: { plan: IndustryPlan }) {
  const missingSkills = plan.skills.filter(s => !s.met);
  const rawMaterials = plan.materials.raw.slice(0, 18);
  return (
    <section className="ind-plan">
      <div className="ind-plan-title">
        <h2>From nothing plan</h2>
        <span>{plan.system ? plan.system.systemName : 'No system selected'}</span>
      </div>

      <div className="ind-summary">
        <div>
          <span className="label">Total serial</span>
          <strong>{formatDuration(plan.totals.totalSerialSeconds)}</strong>
          <small>skills + jobs</small>
        </div>
        <div>
          <span className="label">Industry jobs</span>
          <strong>{formatDuration(plan.totals.jobSeconds)}</strong>
          <small>{plan.totals.jobs} jobs in chain</small>
        </div>
        <div>
          <span className="label">Skill training</span>
          <strong>{formatDuration(plan.totals.skillTrainingSeconds)}</strong>
          <small>{missingSkills.length} missing</small>
        </div>
        <div>
          <span className="label">Install fees</span>
          <strong>{formatIsk(plan.totals.estimatedInstallFees)}</strong>
          <small>{plan.system ? 'estimated from indexes' : 'select system'}</small>
        </div>
      </div>

      {plan.invention && (
        <div className="ind-plan-strip">
          <div>
            <span className="label">Invention source</span>
            <strong>{plan.invention.sourceBlueprintName}</strong>
          </div>
          <div>
            <span className="label">Chance</span>
            <strong>{formatPercent(plan.invention.chance)}</strong>
          </div>
          <div>
            <span className="label">Expected attempts</span>
            <strong>{plan.invention.expectedAttempts.toFixed(2)}</strong>
          </div>
          <div>
            <span className="label">Invented BPC</span>
            <strong>{plan.assumptions.inventionOutput
              ? `${plan.assumptions.inventionOutput.runsPerSuccessfulBpc} run · ME ${plan.assumptions.inventionOutput.me} · TE ${plan.assumptions.inventionOutput.te}`
              : '—'}</strong>
          </div>
          <div>
            <span className="label">Decryptor</span>
            <strong>{plan.assumptions.decryptor.name}</strong>
          </div>
        </div>
      )}

      <div className="ind-two-col">
        <div className="ind-panel">
          <h2>Job chain</h2>
          <div className="ind-table ind-jobs">
            <div className="ind-head"><span>Activity</span><span>Product</span><span>Runs</span><span>Time</span><span>Index</span></div>
            {plan.jobs.map((job, i) => (
              <div key={`${job.blueprintId}-${job.activityId}-${i}`} className="ind-row">
                <span>{job.activityName}</span>
                <span>{job.productName}</span>
                <span>{formatQty(job.runs)}</span>
                <span>{formatDuration(job.adjustedSeconds)}</span>
                <span>{job.systemCostIndex == null ? '—' : formatPercent(job.systemCostIndex)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="ind-panel">
          <h2>Missing skills</h2>
          <div className="ind-table ind-plan-skills">
            <div className="ind-head"><span>Skill</span><span>Current</span><span>Target</span><span>SP</span><span>Time</span></div>
            {missingSkills.length === 0 && <div className="ind-none">All required job and prerequisite skills are trained.</div>}
            {missingSkills.slice(0, 12).map(skill => (
              <div key={skill.skillId} className="ind-row missing">
                <span>{skill.name} <small>r{skill.rank}</small></span>
                <span>{skill.currentLevel}</span>
                <span>{skill.requiredLevel}</span>
                <span>{formatSp(skill.spGap)}</span>
                <span>{formatDuration(skill.trainingSeconds)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ind-panel">
        <h2>{plan.assumptions.buildInputs ? 'Raw/material inputs after recursive build' : 'Inputs to buy'}</h2>
        <div className="ind-table ind-raw">
          <div className="ind-head"><span>Material</span><span>Quantity</span></div>
          {rawMaterials.map(material => (
            <div key={material.typeId} className="ind-row">
              <span>{material.name}</span>
              <span>{formatQty(material.quantity)}</span>
            </div>
          ))}
          {plan.materials.raw.length > rawMaterials.length && (
            <div className="ind-none">Showing {rawMaterials.length} of {plan.materials.raw.length} material lines.</div>
          )}
        </div>
      </div>
    </section>
  );
}

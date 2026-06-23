import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  fetchIndustryQuote,
  searchIndustryBlueprints,
  type CharacterStatus,
  type IndustryBlueprintHit,
  type IndustryQuote,
} from '../api.ts';

interface Props { chars: CharacterStatus[] }

type PilotChoice = 'max' | number;

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
        Advanced facility, rig, system-cost, job-fee, invention, reaction, copy, and research modeling is reserved for the next Industry version.
      </div>
    </section>
  );
}

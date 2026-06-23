import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteSkillPlan,
  fetchItemPlan,
  fetchSavedSkillPlans,
  fetchSdeStatus,
  fetchSkillPlan,
  openInClient,
  saveSkillPlan,
  searchItems,
  searchShips,
  type CharacterStatus,
  type ItemHit,
  type ItemPlan,
  type PlanSkill,
  type SavedSkillPlan,
  type SdeStatus,
  type ShipHit,
  type SkillPlan,
} from '../api.ts';

interface Props { chars: CharacterStatus[] }

const MASTERY_NUMERALS = ['I', 'II', 'III', 'IV', 'V'];

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

export function SkillsView({ chars }: Props) {
  const [characterId, setCharacterId] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem('efd.skills.charId'));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });
  useEffect(() => {
    if (characterId != null) localStorage.setItem('efd.skills.charId', String(characterId));
  }, [characterId]);

  // Default to first authed character once chars load (if nothing saved).
  useEffect(() => {
    if (characterId == null && chars.length > 0) {
      setCharacterId(chars[0].characterId);
    }
  }, [chars, characterId]);

  const [ship, setShip] = useState<ShipHit | null>(null);
  const [masteryLevel, setMasteryLevel] = useState<number>(3);
  const [plan, setPlan] = useState<SkillPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);

  const [item, setItem] = useState<ItemHit | null>(null);
  const [itemPlan, setItemPlan] = useState<ItemPlan | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);
  const [itemPlanning, setItemPlanning] = useState(false);

  useEffect(() => {
    if (!ship || !characterId) { setPlan(null); setPlanError(null); return; }
    let cancelled = false;
    setPlanning(true);
    setPlanError(null);
    fetchSkillPlan(characterId, ship.id, masteryLevel).then(r => {
      if (cancelled) return;
      setPlanning(false);
      if ('error' in r) { setPlanError(r.error); setPlan(null); }
      else setPlan(r);
    });
    return () => { cancelled = true; };
  }, [characterId, ship, masteryLevel]);

  useEffect(() => {
    if (!item || !characterId) { setItemPlan(null); setItemError(null); return; }
    let cancelled = false;
    setItemPlanning(true);
    setItemError(null);
    fetchItemPlan(characterId, item.id).then(r => {
      if (cancelled) return;
      setItemPlanning(false);
      if ('error' in r) { setItemError(r.error); setItemPlan(null); }
      else setItemPlan(r);
    });
    return () => { cancelled = true; };
  }, [characterId, item]);

  const character = useMemo(
    () => chars.find(c => c.characterId === characterId) ?? null,
    [chars, characterId],
  );

  // Saved plans for the active pilot
  const [savedPlans, setSavedPlans] = useState<SavedSkillPlan[]>([]);
  const reloadSaved = useCallback(async () => {
    if (characterId == null) { setSavedPlans([]); return; }
    setSavedPlans(await fetchSavedSkillPlans(characterId));
  }, [characterId]);
  useEffect(() => { reloadSaved(); }, [reloadSaved]);

  const isCurrentSaved = useMemo(() => {
    if (!ship) return false;
    return savedPlans.some(
      p => p.shipId === ship.id && p.masteryLevel === masteryLevel,
    );
  }, [savedPlans, ship, masteryLevel]);

  const onToggleSave = async () => {
    if (!ship || characterId == null) return;
    const existing = savedPlans.find(p => p.shipId === ship.id && p.masteryLevel === masteryLevel);
    if (existing) await deleteSkillPlan(existing.id);
    else await saveSkillPlan(characterId, ship.id, masteryLevel);
    await reloadSaved();
  };

  const onLoadSaved = (p: SavedSkillPlan) => {
    setShip({ id: p.shipId, name: p.shipName, groupName: p.groupName });
    setMasteryLevel(p.masteryLevel);
  };

  const onDeleteSaved = async (p: SavedSkillPlan) => {
    await deleteSkillPlan(p.id);
    await reloadSaved();
  };

  return (
    <main className="rows-wrap skills-view">
      <SdeStaleBanner />
      <div className="skills-controls">
        <div className="sk-control">
          <label>Pilot</label>
          <select
            value={characterId ?? ''}
            onChange={e => setCharacterId(Number(e.target.value) || null)}
          >
            <option value="">Pick a pilot…</option>
            {chars.map(c => (
              <option key={c.characterId} value={c.characterId}>
                {c.name}{c.corporationTicker ? ` [${c.corporationTicker}]` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="sk-control sk-ship">
          <label>Ship</label>
          <ShipSearch value={ship} onChange={setShip} />
        </div>

        <div className="sk-control">
          <label>Mastery target</label>
          <div className="sk-mastery-row">
            {MASTERY_NUMERALS.map((n, i) => (
              <button
                key={n}
                className={`sk-mastery-btn${masteryLevel === i + 1 ? ' active' : ''}`}
                onClick={() => setMasteryLevel(i + 1)}
              >{n}</button>
            ))}
          </div>
        </div>

        <div className="sk-spacer" aria-hidden />

        <div className="sk-control sk-item">
          <label>Module / item</label>
          <ItemSearch value={item} onChange={setItem} />
        </div>
      </div>

      {savedPlans.length > 0 && (
        <SavedPlansBar
          plans={savedPlans}
          activeShipId={ship?.id ?? null}
          activeMastery={masteryLevel}
          onLoad={onLoadSaved}
          onDelete={onDeleteSaved}
        />
      )}

      {!ship && !item && <div className="empty">Pick a ship or a module to see what {character?.name ?? 'this pilot'} needs.</div>}
      {planning && <div className="empty">Computing ship plan…</div>}
      {planError && <div className="empty err">{planError}</div>}

      {plan && !planning && (
        <PlanResults
          plan={plan}
          character={character}
          isSaved={isCurrentSaved}
          onToggleSave={onToggleSave}
        />
      )}

      {itemPlanning && <div className="empty">Computing item plan…</div>}
      {itemError && <div className="empty err">{itemError}</div>}
      {itemPlan && !itemPlanning && <ItemPlanResults plan={itemPlan} />}
    </main>
  );
}

function SavedPlansBar({
  plans, activeShipId, activeMastery, onLoad, onDelete,
}: {
  plans: SavedSkillPlan[];
  activeShipId: number | null;
  activeMastery: number;
  onLoad: (p: SavedSkillPlan) => void;
  onDelete: (p: SavedSkillPlan) => void;
}) {
  return (
    <div className="sk-saved-bar">
      <span className="sk-saved-h">Saved plans</span>
      <div className="sk-saved-list">
        {plans.map(p => {
          const active = activeShipId === p.shipId && activeMastery === p.masteryLevel;
          return (
            <span key={p.id} className={`sk-saved-chip${active ? ' active' : ''}`}>
              <button className="sk-saved-load" onClick={() => onLoad(p)}>
                {p.shipName} <span className="sk-saved-m">{MASTERY_NUMERALS[p.masteryLevel - 1]}</span>
              </button>
              <button className="sk-saved-rm" onClick={() => onDelete(p)} title="Remove">×</button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ShipSearch({ value, onChange }: { value: ShipHit | null; onChange: (s: ShipHit | null) => void }) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [hits, setHits] = useState<ShipHit[]>([]);
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
      const r = await searchShips(query, ctl.signal).catch(() => []);
      setHits(r);
      setActive(r.length > 0 ? 0 : -1);
    }, 120);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, value]);

  const pick = (h: ShipHit) => {
    onChange(h);
    setQuery(h.name);
    setHits([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(hits[active]); }
    else if (e.key === 'Escape') { setHits([]); }
  };

  return (
    <div className="sk-ship-search">
      <input
        className="ap-input"
        type="text"
        placeholder="Ship name…"
        value={query}
        onChange={e => { setQuery(e.target.value); if (value) onChange(null); }}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {hits.length > 0 && (
        <ul className="ap-suggestions sk-suggestions">
          {hits.map((h, i) => (
            <li key={h.id} className={i === active ? 'active' : ''} onMouseDown={() => pick(h)}>
              <span>{h.name}</span>
              <span className="dim">{h.groupName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanResults({ plan, character, isSaved, onToggleSave }: {
  plan: SkillPlan;
  character: CharacterStatus | null;
  isSaved: boolean;
  onToggleSave: () => void;
}) {
  return (
    <div className="sk-plan">
      <div className="sk-plan-summary">
        <div>
          <button
            className={`sk-save${isSaved ? ' on' : ''}`}
            onClick={onToggleSave}
            title={isSaved ? 'Remove from saved plans' : 'Save this plan'}
          >★</button>
          <span className="sk-h1">{plan.ship.name}</span>
          <span className="dim"> · {plan.ship.groupName} · Mastery {MASTERY_NUMERALS[plan.masteryLevel - 1]}</span>
        </div>
        <div className="sk-totals">
          <span><b>{plan.totals.skillsToTrain}</b> skills to train</span>
          <span><b>{plan.totals.skillsMet}</b> already met</span>
          <span className="sk-total-sp">SP needed: <b>{plan.totals.totalSpGap.toLocaleString()}</b></span>
          <span>Training time: <b>{formatDuration(plan.totals.totalTrainingSeconds)}</b></span>
        </div>
      </div>

      {character && (
        <div className="sk-pilot-line dim">
          {character.name} · {formatSp(plan.characterTotalSp)} total SP
        </div>
      )}

      <div className="sk-table">
        <div className="sk-row sk-thead">
          <div>Skill</div>
          <div className="r">Rank</div>
          <div className="c">Current</div>
          <div className="c">Target</div>
          <div className="r">SP gap</div>
          <div className="r">Training</div>
          <div>Source</div>
          <div className="c">Actions</div>
        </div>
        {plan.skills.map(s => (
          <PlanRow key={s.skillId} skill={s} characterId={plan.characterId} />
        ))}
      </div>
    </div>
  );
}

function PlanRow({ skill: s, characterId }: { skill: PlanSkill; characterId: number }) {
  const [busy, setBusy] = useState<'info' | 'market' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const met = s.currentLevel >= s.targetLevel;

  const onOpen = async (kind: 'info' | 'market') => {
    setBusy(kind);
    setError(null);
    const r = await openInClient(characterId, s.skillId, kind);
    setBusy(null);
    if (!r.ok) setError(r.error ?? 'failed');
    else setTimeout(() => setError(null), 0);
  };

  return (
    <div className={`sk-row${met ? ' met' : ''}`}>
      <div className="sk-name">{s.name}</div>
      <div className="r dim">×{s.rank}</div>
      <div className="c">{s.currentLevel}</div>
      <div className="c"><b>{s.targetLevel}</b></div>
      <div className="r">
        {met ? <span className="dim">—</span> : <b>{s.spGap.toLocaleString()}</b>}
      </div>
      <div className="r">
        {met ? <span className="dim">—</span> : <b>{formatDuration(s.trainingSeconds)}</b>}
      </div>
      <div className="sk-sources">
        {s.sources.map((src, i) => (
          <span key={i} className={`sk-src ${src.kind}`}>
            {src.kind === 'ship-prereq' ? 'prereq' : src.certName}
          </span>
        ))}
      </div>
      <div className="sk-row-actions">
        <button
          className="sk-action"
          disabled={busy !== null}
          onClick={() => onOpen('info')}
          title="Show Info in client"
        >{busy === 'info' ? '…' : 'Info'}</button>
        <button
          className="sk-action"
          disabled={busy !== null}
          onClick={() => onOpen('market')}
          title="Open in Market"
        >{busy === 'market' ? '…' : 'Market'}</button>
        {error && <span className="sk-action-err" title={error}>!</span>}
      </div>
    </div>
  );
}

function ItemSearch({ value, onChange }: { value: ItemHit | null; onChange: (i: ItemHit | null) => void }) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [hits, setHits] = useState<ItemHit[]>([]);
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
      const r = await searchItems(query, ctl.signal).catch(() => []);
      setHits(r);
      setActive(r.length > 0 ? 0 : -1);
    }, 120);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, value]);

  const pick = (h: ItemHit) => { onChange(h); setQuery(h.name); setHits([]); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(hits[active]); }
    else if (e.key === 'Escape') { setHits([]); }
  };

  return (
    <div className="sk-ship-search">
      <input
        className="ap-input"
        type="text"
        placeholder="Module, drone, ammo…"
        value={query}
        onChange={e => { setQuery(e.target.value); if (value) onChange(null); }}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {hits.length > 0 && (
        <ul className="ap-suggestions sk-suggestions">
          {hits.map((h, i) => (
            <li key={h.id} className={i === active ? 'active' : ''} onMouseDown={() => pick(h)}>
              <span>{h.name}</span>
              <span className="dim">{h.categoryName} · {h.groupName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemPlanResults({ plan }: { plan: ItemPlan }) {
  return (
    <div className="sk-plan">
      <div className="sk-plan-summary">
        <div>
          <span className="sk-h1">{plan.item.name}</span>
          <span className="dim"> · {plan.item.categoryName} · {plan.item.groupName}</span>
        </div>
        <div className="sk-totals">
          <span><b>{plan.totals.skillsToTrain}</b> skills to train</span>
          <span><b>{plan.totals.skillsMet}</b> already met</span>
          <span className="sk-total-sp">SP needed: <b>{plan.totals.totalSpGap.toLocaleString()}</b></span>
          <span>Training time: <b>{formatDuration(plan.totals.totalTrainingSeconds)}</b></span>
        </div>
      </div>
      <div className="sk-table">
        <div className="sk-row sk-thead">
          <div>Skill</div>
          <div className="r">Rank</div>
          <div className="c">Current</div>
          <div className="c">Target</div>
          <div className="r">SP gap</div>
          <div className="r">Training</div>
          <div>Source</div>
          <div className="c">Actions</div>
        </div>
        {plan.skills.map(s => (
          <PlanRow key={s.skillId} skill={s} characterId={plan.characterId} />
        ))}
      </div>
    </div>
  );
}

function SdeStaleBanner() {
  const [status, setStatus] = useState<SdeStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { fetchSdeStatus().then(setStatus); }, []);
  if (!status || !status.stale || dismissed) return null;
  return (
    <div className="sde-stale">
      <span>EVE SDE has been updated since this app's mastery data was built. Run <code>npm run build:mastery</code> to refresh.</span>
      <button onClick={() => setDismissed(true)}>Dismiss</button>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  deleteSkillPlan,
  fetchCharacterSkillsOverview,
  fetchItemPlan,
  fetchSavedSkillPlans,
  fetchSdeStatus,
  fetchSkillPlan,
  openInClient,
  saveSkillPlan,
  searchSkillsAcrossPilots,
  searchItems,
  searchShips,
  type CharacterSkillsOverview,
  type CharacterStatus,
  type ItemHit,
  type ItemPlan,
  type PlanSkill,
  type SavedSkillPlan,
  type SdeStatus,
  type ShipHit,
  type SkillComparison,
  type SkillPlan,
} from '../api.ts';

interface Props { chars: CharacterStatus[] }

const MASTERY_NUMERALS = ['I', 'II', 'III', 'IV', 'V'];
type PilotSortMode = 'alpha' | 'queue';
type SkillSearchResult = {
  query: string;
  comparison: SkillComparison | null;
  error: string | null;
  loading: boolean;
};

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

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function secondsUntil(value: string | null, nowMs = Date.now()): number {
  if (!value) return 0;
  return Math.max(0, Math.floor((Date.parse(value) - nowMs) / 1000));
}

function levelLabel(level: number): string {
  return MASTERY_NUMERALS[level - 1] ?? String(level);
}

export function formatSkillQueueRemainingLabel(queueEnd: string | null, nowMs = Date.now()): string {
  if (queueEnd === null) return 'queue unknown';
  if (queueEnd === '') return 'queue empty';
  const remaining = secondsUntil(queueEnd, nowMs);
  return remaining > 0 ? `${formatDuration(remaining)} left` : 'queue ended';
}

export function formatPilotSkillOptionLabel(character: CharacterStatus, nowMs = Date.now()): string {
  const corp = character.corporationTicker ? ` [${character.corporationTicker}]` : '';
  return `${character.name}${corp} - ${formatSkillQueueRemainingLabel(character.trainingQueueEnd, nowMs)}`;
}

function queueSortValue(queueEnd: string | null, nowMs: number): number {
  if (queueEnd === null) return Number.POSITIVE_INFINITY;
  if (queueEnd === '') return 0;
  const parsed = Date.parse(queueEnd);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, parsed - nowMs);
}

export function sortSkillPilots(chars: CharacterStatus[], mode: PilotSortMode, nowMs = Date.now()): CharacterStatus[] {
  const byName = (a: CharacterStatus, b: CharacterStatus) =>
    a.name.localeCompare(b.name) || a.characterId - b.characterId;
  const sorted = [...chars];
  if (mode === 'queue') {
    return sorted.sort((a, b) =>
      queueSortValue(a.trainingQueueEnd, nowMs) - queueSortValue(b.trainingQueueEnd, nowMs) || byName(a, b),
    );
  }
  return sorted.sort(byName);
}

export function SkillsView({ chars }: Props) {
  const [characterId, setCharacterId] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem('efd.skills.charId'));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });
  const [pilotSort, setPilotSort] = useState<PilotSortMode>(() =>
    localStorage.getItem('efd.skills.pilotSort') === 'queue' ? 'queue' : 'alpha',
  );
  useEffect(() => {
    if (characterId != null) localStorage.setItem('efd.skills.charId', String(characterId));
  }, [characterId]);
  useEffect(() => {
    localStorage.setItem('efd.skills.pilotSort', pilotSort);
  }, [pilotSort]);

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
  const [mode, setMode] = useState<'overview' | 'plans'>('overview');
  const [overview, setOverview] = useState<CharacterSkillsOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [skillSearchInput, setSkillSearchInput] = useState('');
  const [skillSearchResult, setSkillSearchResult] = useState<SkillSearchResult | null>(null);
  const skillSearchAbort = useRef<AbortController | null>(null);

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
  const sortedChars = useMemo(
    () => sortSkillPilots(chars, pilotSort),
    [chars, pilotSort],
  );

  const reloadOverview = useCallback(async () => {
    if (characterId == null) {
      setOverview(null);
      setOverviewError(null);
      return;
    }
    setOverviewLoading(true);
    setOverviewError(null);
    const result = await fetchCharacterSkillsOverview(characterId);
    setOverviewLoading(false);
    if ('error' in result) {
      setOverview(null);
      setOverviewError(result.error);
      return;
    }
    setOverview(result);
  }, [characterId]);

  useEffect(() => { reloadOverview(); }, [reloadOverview]);

  const runSkillSearch = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const q = skillSearchInput.trim();
    skillSearchAbort.current?.abort();

    if (q.length < 2) {
      setSkillSearchResult(null);
      return;
    }

    const ctl = new AbortController();
    skillSearchAbort.current = ctl;
    setSkillSearchResult({ query: q, comparison: null, error: null, loading: true });
    const result = await searchSkillsAcrossPilots(q, ctl.signal).catch(error => {
      if (ctl.signal.aborted) return null;
      return { error: error instanceof Error ? error.message : 'skill search failed' };
    });
    if (ctl.signal.aborted || result === null) return;

    if ('error' in result) {
      setSkillSearchResult({ query: q, comparison: null, error: result.error, loading: false });
    } else {
      setSkillSearchResult({ query: q, comparison: result, error: null, loading: false });
    }
  }, [skillSearchInput]);

  useEffect(() => () => {
    skillSearchAbort.current?.abort();
  }, []);

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
      <div className={`skills-controls${mode === 'overview' ? ' sk-overview-controls' : ''}`}>
        <div className="sk-control">
          <label>Pilot</label>
          <select
            value={characterId ?? ''}
            onChange={e => setCharacterId(Number(e.target.value) || null)}
          >
            <option value="">Pick a pilot…</option>
            {sortedChars.map(c => (
              <option key={c.characterId} value={c.characterId}>
                {formatPilotSkillOptionLabel(c)}
              </option>
            ))}
          </select>
        </div>

        <div className="sk-control sk-pilot-sort">
          <label>Sort pilots</label>
          <select
            value={pilotSort}
            onChange={e => setPilotSort(e.target.value === 'queue' ? 'queue' : 'alpha')}
          >
            <option value="alpha">Alphabetical</option>
            <option value="queue">Shortest queue</option>
          </select>
        </div>

        <div className="sk-control">
          <label>View</label>
          <div className="sk-mastery-row sk-mode-row">
            <button
              className={`sk-mastery-btn${mode === 'overview' ? ' active' : ''}`}
              onClick={() => setMode('overview')}
            >Pilot Skills</button>
            <button
              className={`sk-mastery-btn${mode === 'plans' ? ' active' : ''}`}
              onClick={() => setMode('plans')}
            >Skill Plans</button>
          </div>
        </div>

        {mode === 'plans' && (
          <>
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
          </>
        )}

        <div className="sk-spacer" aria-hidden />

        {mode === 'overview' ? (
          <>
            <form className="sk-control sk-all-skill-search" onSubmit={runSkillSearch}>
              <label>Find skill across pilots</label>
              <div className="sk-skill-search-row">
                <input
                  className="ap-input"
                  type="search"
                  placeholder="Skill name..."
                  value={skillSearchInput}
                  onChange={e => setSkillSearchInput(e.target.value)}
                />
                <button
                  className="sk-refresh sk-search-submit"
                  type="submit"
                  disabled={skillSearchInput.trim().length < 2 || skillSearchResult?.loading}
                >
                  {skillSearchResult?.loading ? 'Searching...' : 'Search'}
                </button>
              </div>
            </form>
            <button className="sk-refresh" onClick={reloadOverview} disabled={overviewLoading || characterId == null}>
              {overviewLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </>
        ) : (
          <div className="sk-control sk-item">
            <label>Module / item</label>
            <ItemSearch value={item} onChange={setItem} />
          </div>
        )}

        {mode === 'overview' && skillSearchResult && (
          <div className="sk-search-results-row">
            <SkillComparisonPanel
              query={skillSearchResult.query}
              comparison={skillSearchResult.comparison}
              loading={skillSearchResult.loading}
              error={skillSearchResult.error}
            />
          </div>
        )}
      </div>

      {mode === 'overview' && (
        <>
          {!characterId && <div className="empty">Pick a pilot to see their skill queue and trained skills.</div>}
          {overviewLoading && <div className="empty">Loading pilot skills...</div>}
          {overviewError && <div className="empty err">{overviewError}</div>}
          {overview && !overviewLoading && (
            <CharacterSkillsPanel overview={overview} character={character} />
          )}
        </>
      )}

      {mode === 'plans' && (
        <>
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
          {planning && <div className="empty">Computing ship plan...</div>}
          {planError && <div className="empty err">{planError}</div>}

          {plan && !planning && (
            <PlanResults
              plan={plan}
              character={character}
              isSaved={isCurrentSaved}
              onToggleSave={onToggleSave}
            />
          )}

          {itemPlanning && <div className="empty">Computing item plan...</div>}
          {itemError && <div className="empty err">{itemError}</div>}
          {itemPlan && !itemPlanning && <ItemPlanResults plan={itemPlan} />}
        </>
      )}
    </main>
  );
}

function CharacterSkillsPanel({ overview, character }: { overview: CharacterSkillsOverview; character: CharacterStatus | null }) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!q) return overview.groups;
    return overview.groups
      .map(group => {
        const skills = group.skills.filter(skill =>
          skill.name.toLowerCase().includes(q) || group.groupName.toLowerCase().includes(q),
        );
        return {
          ...group,
          trainedSkills: skills.length,
          totalSp: skills.reduce((sum, skill) => sum + skill.skillpointsInSkill, 0),
          skills,
        };
      })
      .filter(group => group.skills.length > 0);
  }, [overview.groups, q]);

  const current = overview.queue.find(entry => {
    if (!entry.startDate || !entry.finishDate) return false;
    const now = Date.now();
    return Date.parse(entry.startDate) <= now && now < Date.parse(entry.finishDate);
  }) ?? overview.queue[0] ?? null;

  return (
    <div className="sk-overview">
      <div className="sk-overview-head">
        <div>
          <h2>{character?.name ?? `Pilot ${overview.characterId}`}</h2>
          <p className="dim">Skill queue and trained skills from cached ESI polling.</p>
        </div>
        <span className="dim">Updated {formatDateTime(new Date(overview.refreshedAt).toISOString())}</span>
      </div>

      <div className="sk-summary-cards">
        <div className="sk-summary-card">
          <span>Total SP</span>
          <b>{formatSp(overview.totals.totalSp)}</b>
        </div>
        <div className="sk-summary-card">
          <span>Unallocated</span>
          <b>{formatSp(overview.totals.unallocatedSp)}</b>
        </div>
        <div className="sk-summary-card">
          <span>Trained Skills</span>
          <b>{overview.totals.trainedSkills.toLocaleString()}</b>
        </div>
        <div className="sk-summary-card">
          <span>Queue</span>
          <b>{overview.totals.queueLength.toLocaleString()}</b>
        </div>
      </div>

      <section className="sk-section">
        <div className="sk-section-title">
          <h3>Skill Queue</h3>
          {current && (
            <span className="dim">
              Training {current.name} {levelLabel(current.finishedLevel)} · {formatDuration(secondsUntil(current.finishDate))} left
            </span>
          )}
        </div>
        {overview.queue.length === 0 ? (
          <div className="empty sk-empty-inline">No skills are queued.</div>
        ) : (
          <div className="sk-queue-table">
            <div className="sk-queue-row sk-queue-head">
              <div>#</div>
              <div>Skill</div>
              <div>Type</div>
              <div className="c">Level</div>
              <div>Finish</div>
              <div className="r">Remaining</div>
            </div>
            {overview.queue.map(entry => (
              <div key={`${entry.queuePosition}-${entry.skillId}-${entry.finishedLevel}`} className="sk-queue-row">
                <div className="dim">{entry.queuePosition}</div>
                <div className="sk-name">{entry.name}</div>
                <div className="dim">{entry.groupName}</div>
                <div className="c">{levelLabel(entry.finishedLevel)}</div>
                <div>{formatDateTime(entry.finishDate)}</div>
                <div className="r">{formatDuration(secondsUntil(entry.finishDate))}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="sk-section">
        <div className="sk-section-title">
          <h3>All Skills</h3>
          <input
            className="ap-input sk-filter"
            type="search"
            placeholder="Search skills or groups"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <div className="sk-groups">
          {groups.map(group => (
            <details key={group.groupName} className="sk-group" open>
              <summary>
                <span>{group.groupName}</span>
                <span className="dim">{group.skills.length} skills · {formatSp(group.totalSp)} SP</span>
              </summary>
              <div className="sk-skill-list">
                <div className="sk-skill-row sk-skill-head">
                  <div>Skill</div>
                  <div className="r">Rank</div>
                  <div className="c">Active</div>
                  <div className="c">Trained</div>
                  <div className="r">SP</div>
                </div>
                {group.skills.map(skill => (
                  <div key={skill.skillId} className="sk-skill-row">
                    <div className="sk-name">{skill.name}</div>
                    <div className="r dim">x{skill.rank}</div>
                    <div className="c">{levelLabel(skill.activeSkillLevel)}</div>
                    <div className="c">{levelLabel(skill.trainedSkillLevel)}</div>
                    <div className="r">{skill.skillpointsInSkill.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </details>
          ))}
          {groups.length === 0 && <div className="empty sk-empty-inline">No skills match that search.</div>}
        </div>
      </section>
    </div>
  );
}

function SkillComparisonPanel({
  query,
  comparison,
  loading,
  error,
}: {
  query: string;
  comparison: SkillComparison | null;
  loading: boolean;
  error: string | null;
}) {
  const trimmed = query.trim();

  return (
    <section className="sk-section sk-compare">
      <div className="sk-section-title">
        <div>
          <h3>Skill Search</h3>
          <p className="dim">
            {loading
              ? `Searching all pilots for "${trimmed}"...`
              : comparison
                ? `${comparison.matches.length} match${comparison.matches.length === 1 ? '' : 'es'} across ${comparison.cachedPilotCount}/${comparison.pilotCount} cached pilots`
                : `Search all pilots for "${trimmed}"`}
          </p>
        </div>
      </div>

      {error && <div className="empty err sk-empty-inline">{error}</div>}
      {!error && loading && <div className="empty sk-empty-inline">Searching pilot skills...</div>}
      {!error && !loading && comparison && comparison.matches.length === 0 && (
        <div className="empty sk-empty-inline">No skills match that search.</div>
      )}

      {!error && comparison && comparison.matches.length > 0 && (
        <div className="sk-compare-matches">
          {comparison.matches.map(match => (
            <div key={match.skillId} className="sk-compare-match">
              <div className="sk-compare-match-head">
                <div>
                  <b>{match.name}</b>
                  <span className="dim"> {match.groupName} · rank x{match.rank}</span>
                </div>
              </div>
              <div className="sk-compare-table">
                <div className="sk-compare-row sk-skill-head">
                  <div>Pilot</div>
                  <div className="c">Active</div>
                  <div className="c">Trained</div>
                  <div className="r">SP</div>
                  <div>Status</div>
                </div>
                {match.pilots.map(pilot => (
                  <div key={pilot.characterId} className="sk-compare-row">
                    <div className="sk-name">{pilot.characterName}</div>
                    <div className="c">
                      {pilot.skillsAvailable && pilot.activeSkillLevel != null ? levelLabel(pilot.activeSkillLevel) : '—'}
                    </div>
                    <div className="c">
                      {pilot.skillsAvailable && pilot.trainedSkillLevel != null ? levelLabel(pilot.trainedSkillLevel) : '—'}
                    </div>
                    <div className="r">
                      {pilot.skillpointsInSkill != null ? formatSp(pilot.skillpointsInSkill) : '—'}
                    </div>
                    <div className={pilot.skillsAvailable ? 'dim' : 'warn'}>
                      {pilot.skillsAvailable ? (pilot.trainedSkillLevel ? 'Trained' : 'Not trained') : 'Not polled'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
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

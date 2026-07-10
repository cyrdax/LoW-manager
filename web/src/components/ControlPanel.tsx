import { useEffect, useRef, useState } from 'react';
import {
  fetchFleetStructure,
  inviteAll,
  moveToSquad,
  searchSystems,
  setWaypointAll,
  type CharacterStatus,
  type FleetStructure,
  type InviteResult,
  type SystemHit,
  type WaypointResult,
} from '../api.ts';

type View = 'pilots' | 'planets' | 'skills' | 'fleet' | 'market' | 'industry' | 'contracts' | 'fits';

interface Props {
  chars: CharacterStatus[];
  selection: Set<number>;
  onRefresh: () => void;
  view: View;
  setView: (v: View) => void;
}

export function ControlPanel({ chars, selection, onRefresh, view, setView }: Props) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [resultsLabel, setResultsLabel] = useState<'invited' | 'moved' | 'ok'>('ok');
  const [error, setError] = useState<string | null>(null);
  const [structure, setStructure] = useState<FleetStructure | null>(null);
  const [targetKey, setTargetKey] = useState<string>('auto');

  const boss = chars.find(c => c.isBoss);
  const bossInFleet = boss?.fleetId != null;
  const bossIsFC = boss?.fleetRole === 'fleet_commander';
  // ESI's `/fleets/{id}/...` writes require the caller to be the fleet_boss_id —
  // the character who originally formed the fleet — not just to hold the FC role.
  const fleetBossId = structure?.fleet?.fleet_boss_id;
  const bossIsFleetOwner = boss != null && fleetBossId != null && boss.characterId === fleetBossId;
  const bossNotOwner = bossIsFC && fleetBossId != null && fleetBossId !== boss?.characterId;

  // Fetch the fleet's wing/squad tree when the boss is FC of a fleet.
  // Fast retry while wings aren't readable (ESI registration lag is 10–60s typical);
  // back off to idle once we have them.
  const [pokeNonce, setPokeNonce] = useState(0);
  useEffect(() => {
    if (!bossInFleet || !bossIsFC) { setStructure(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const s = await fetchFleetStructure().catch(() => null);
      if (cancelled) return;
      setStructure(s);
      const haveWings = s && s.wings.some(w => w.squads.length > 0);
      if (!haveWings) timer = setTimeout(tick, 2_500);
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [bossInFleet, bossIsFC, boss?.fleetId, pokeNonce]);

  const selectedIds = Array.from(selection);
  const selectedCharsNonBoss = chars.filter(c => selection.has(c.characterId) && !c.isBoss && !c.needsReauth);
  const wingsVisible = !!structure && structure.wings.some(w => w.squads.length > 0);
  const canInvite = !!boss && bossInFleet && bossIsFC && wingsVisible && selectedCharsNonBoss.length > 0;

  const parsedTarget = (() => {
    if (targetKey === 'auto' || !structure) return undefined;
    const [w, s] = targetKey.split(':').map(Number);
    if (!Number.isFinite(w) || !Number.isFinite(s)) return undefined;
    return { wing_id: w, squad_id: s };
  })();

  // Move uses the boss's fleet_commander token (ESI doesn't honor in-client
  // free-move for the PUT call — a member's own token gets 404). So the boss
  // must be FC of the same fleet as the pilots being moved.
  const moveable = selectedCharsNonBoss.filter(c => c.fleetId != null && c.fleetId === boss?.fleetId);
  const canMove = bossIsFC && parsedTarget != null && moveable.length > 0;

  const openAuth = () => {
    const w = window.open('/auth/login', '_blank', 'width=560,height=720');
    const poll = setInterval(() => {
      if (!w || w.closed) {
        clearInterval(poll);
        setTimeout(onRefresh, 250);
      }
    }, 500);
  };

  const doInviteAll = async () => {
    setBusy(true);
    setError(null);
    setResults(null);
    const r = await inviteAll(selectedCharsNonBoss.map(c => c.characterId), parsedTarget);
    setBusy(false);
    if (r.error) setError(r.error);
    else { setResultsLabel('invited'); setResults(r.results); }
  };

  const doMove = async () => {
    if (!parsedTarget) return;
    setBusy(true);
    setError(null);
    setResults(null);
    const r = await moveToSquad(moveable.map(c => c.characterId), parsedTarget);
    setBusy(false);
    if (r.error) setError(r.error);
    else { setResultsLabel('moved'); setResults(r.results); }
  };

  return (
    <aside className="sidebar">
      <div>
        <h1>Legion of Wayne Manger</h1>
        <small>{chars.length} characters · {selection.size} selected</small>
      </div>

      <div className="view-nav view-nav-8">
        <button
          className={`nav-btn${view === 'pilots' ? ' active' : ''}`}
          onClick={() => setView('pilots')}
        >Pilots</button>
        <button
          className={`nav-btn${view === 'planets' ? ' active' : ''}`}
          onClick={() => setView('planets')}
        >Planets</button>
        <button
          className={`nav-btn${view === 'skills' ? ' active' : ''}`}
          onClick={() => setView('skills')}
        >Skills</button>
        <button
          className={`nav-btn${view === 'fleet' ? ' active' : ''}`}
          onClick={() => setView('fleet')}
        >Fleet</button>
        <button
          className={`nav-btn${view === 'market' ? ' active' : ''}`}
          onClick={() => setView('market')}
        >Market</button>
        <button
          className={`nav-btn${view === 'industry' ? ' active' : ''}`}
          onClick={() => setView('industry')}
        >Industry</button>
        <button
          className={`nav-btn${view === 'contracts' ? ' active' : ''}`}
          onClick={() => setView('contracts')}
        >Contracts</button>
        <button
          className={`nav-btn${view === 'fits' ? ' active' : ''}`}
          onClick={() => setView('fits')}
        >Fits</button>
      </div>

      <button className="primary" onClick={openAuth}>Add character</button>

      {view === 'pilots' && <AutopilotPanel selectedIds={selectedIds} />}

      {view === 'contracts' && (
        <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.4 }}>
          Search public ship contracts around an origin system. V1 uses public item-exchange and auction contracts only; player-structure locations may show as unknown.
        </div>
      )}

      {view === 'pilots' && <>
      <div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>Fleet boss</div>
        <div style={{ fontSize: 14 }}>
          {boss ? boss.name : <span style={{ color: 'var(--dim)' }}>Click ★ on a row →</span>}
        </div>
        {boss && (
          <div style={{ fontSize: 12, marginTop: 4, color: bossInFleet && bossIsFC && bossIsFleetOwner ? 'var(--green)' : 'var(--amber)' }}>
            {!bossInFleet && 'Not in a fleet — form one in-client.'}
            {bossInFleet && bossIsFC && bossIsFleetOwner && `Fleet boss · fleet ${boss!.fleetId}`}
            {bossInFleet && bossIsFC && bossNotOwner && (
              <>FC role but <b>not the fleet owner</b>. Right-click in the fleet window → <b>Transfer Fleet Boss</b> to {boss!.name}.</>
            )}
            {bossInFleet && !bossIsFC && (
              <>Currently {boss!.fleetRole ?? 'member'}. Drag this character to the <b>Fleet Commander</b> slot in-client.</>
            )}
          </div>
        )}
      </div>

      {(() => {
        // FC-read squads (authoritative, all wings/squads) come from structure.
        type Opt = { key: string; label: string; source: 'fc' | 'members' };
        const fcOpts: Opt[] = (structure?.wings ?? []).flatMap(w =>
          w.squads.map(s => ({
            key: `${w.id}:${s.id}`,
            label: `${w.name || `Wing ${w.id}`} / ${s.name || `Squad ${s.id}`}`,
            source: 'fc' as const,
          })),
        );
        // Fallback: squads our own pilots happen to be in. Only useful when structure isn't readable.
        const fleetIdForFallback = boss?.fleetId ?? chars.find(c => c.fleetId != null)?.fleetId;
        const memberOpts: Opt[] = [];
        if (fleetIdForFallback != null) {
          const seen = new Set<string>();
          for (const c of chars) {
            if (c.fleetId !== fleetIdForFallback) continue;
            if (c.fleetWingId == null || c.fleetSquadId == null) continue;
            const key = `${c.fleetWingId}:${c.fleetSquadId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const occupants = chars.filter(c2 => c2.fleetWingId === c.fleetWingId && c2.fleetSquadId === c.fleetSquadId).length;
            memberOpts.push({
              key,
              label: `Wing ${c.fleetWingId} / Squad ${c.fleetSquadId}  (${occupants} of yours here)`,
              source: 'members',
            });
          }
        }
        const seenFc = new Set(fcOpts.map(o => o.key));
        const opts = [...fcOpts, ...memberOpts.filter(m => !seenFc.has(m.key))];

        const anyBossInFleet = bossInFleet;
        if (!anyBossInFleet && opts.length === 0) return null;

        return (
          <div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>Invite / move target</div>
            {opts.length > 0 ? (
              <>
                <select value={targetKey} onChange={e => setTargetKey(e.target.value)} style={{ width: '100%' }}>
                  <option value="auto">Auto (first wing with a squad)</option>
                  {fcOpts.length > 0 && (
                    <optgroup label="From FC token (authoritative)">
                      {fcOpts.map(o => (<option key={o.key} value={o.key}>{o.label}</option>))}
                    </optgroup>
                  )}
                  {memberOpts.filter(m => !seenFc.has(m.key)).length > 0 && (
                    <optgroup label="Known via your pilots">
                      {memberOpts.filter(m => !seenFc.has(m.key)).map(o => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
                  {fcOpts.length > 0
                    ? 'ESI doesn\u2019t expose the fleet\u2019s default squad flag \u2014 pick explicitly.'
                    : 'Boss isn\u2019t FC, so we can\u2019t read the full wing/squad tree. These squads come from pilots of yours already in the fleet.'}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--amber)' }}>
                {bossNotOwner ? (
                  <div>
                    {boss!.name} is at the Fleet Commander slot but isn't the original fleet boss (someone else formed this fleet). ESI write endpoints check the original boss, not just the FC role. Right-click {boss!.name} in the in-client fleet window → <b>Transfer Fleet Boss</b> to give them ESI authority.
                  </div>
                ) : (
                  <div>
                    ESI can't read this fleet's wings ({structure?.error ?? 'loading'}) and none of your pilots are in it yet. Usually clears within 10–60 s of forming a fresh fleet.
                  </div>
                )}
                <button
                  style={{ marginTop: 6, padding: '4px 10px', fontSize: 12 }}
                  onClick={() => setPokeNonce(n => n + 1)}
                >
                  Check now
                </button>
              </div>
            )}
          </div>
        );
      })()}

      <button className="primary" disabled={!canInvite || busy} onClick={doInviteAll}>
        {busy ? 'Working…' : `Invite selected (${selectedCharsNonBoss.length})`}
      </button>

      <button
        disabled={!canMove || busy}
        onClick={doMove}
        title={
          !bossIsFC ? 'Boss must be in the Fleet Commander slot to move pilots via ESI'
          : !parsedTarget ? 'Pick a specific wing/squad above (not Auto) to move into'
          : moveable.length === 0 ? 'No selected characters are in the boss\u2019s fleet'
          : `Move ${moveable.length} to the chosen squad`
        }
      >
        {busy ? 'Working…' : `Move selected to target (${moveable.length})`}
      </button>

      {error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>}

      {results && (
        <div className="results">
          <div style={{ fontSize: 12, color: 'var(--dim)' }}>Results</div>
          {results.map(r => (
            <div key={r.characterId} className="row">
              <span>{r.name}</span>
              <span className={r.ok ? 'ok' : 'err'}>{r.ok ? resultsLabel : r.error}</span>
            </div>
          ))}
        </div>
      )}
      </>}

      {view === 'planets' && (
        <div style={{ fontSize: 12, color: 'var(--dim)' }}>
          PI is read-only via ESI — extractor timers, colony counts, and idle alerts.
          Re-auth pilots if you see "loading" or "—" in the table (the new <code>manage_planets</code> scope was added recently).
        </div>
      )}

      {view === 'market' && (
        <div style={{ fontSize: 12, color: 'var(--dim)' }}>
          PLEX trades on its own dedicated global market (since 2017). History is 1-day resolution, ~310 days back. Current spread updates every 5 min.
        </div>
      )}

      {view === 'industry' && (
        <div style={{ fontSize: 12, color: 'var(--dim)' }}>
          Manufacturing quotes plus build-chain planning. Max skills is a virtual pilot; real pilots use the cached ESI skills poll.
        </div>
      )}

      <div style={{ flex: 1 }} />
      <small style={{ color: 'var(--dim)' }}>
        {view === 'pilots'
          ? <>Watchlists: once every alt is in the boss's fleet, the in-game <b>Fleet Watchlist</b> auto-populates.</>
          : <>Max colonies = 1 + Interplanetary Consolidation level (V&nbsp;= 6 colonies).</>}
      </small>
    </aside>
  );
}

function AutopilotPanel({ selectedIds }: { selectedIds: number[] }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SystemHit[]>([]);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [apResults, setApResults] = useState<WaypointResult[] | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (abortRef.current) abortRef.current.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;

    debounce.current = setTimeout(async () => {
      const r = await searchSystems(query, ctl.signal).catch(() => []);
      setHits(r);
      setActive(r.length > 0 ? 0 : -1);
    }, 120);

    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]);

  const pick = async (hit: SystemHit) => {
    setBusy(true);
    setApResults(null);
    const r = await setWaypointAll(hit.id, selectedIds.length ? selectedIds : undefined)
      .catch(() => ({ destination_id: hit.id, results: [] as WaypointResult[] }));
    setBusy(false);
    setApResults(r.results);
    setQuery(hit.name);
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
    <div className="autopilot">
      <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>
        Set waypoint · {selectedIds.length ? `${selectedIds.length} selected` : 'all online'}
      </div>
      <input
        className="ap-input"
        type="text"
        placeholder="system name…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={busy}
        autoComplete="off"
      />
      {hits.length > 0 && (
        <ul className="ap-suggestions">
          {hits.map((h, i) => (
            <li key={h.id} className={i === active ? 'active' : ''} onMouseDown={() => pick(h)}>
              {h.name}
            </li>
          ))}
        </ul>
      )}
      {apResults && (
        <div className="results" style={{ marginTop: 6 }}>
          {apResults.map(r => (
            <div key={r.characterId} className="row">
              <span>{r.name}</span>
              <span className={r.ok ? 'ok' : 'err'}>{r.ok ? 'waypoint set' : r.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

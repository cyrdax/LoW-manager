import { useEffect, useRef, useState } from 'react';
import {
  fetchFleetStructure,
  inviteAll,
  searchSystems,
  setWaypointAll,
  type CharacterStatus,
  type FleetStructure,
  type InviteResult,
  type SystemHit,
  type WaypointResult,
} from '../api.ts';

interface Props {
  chars: CharacterStatus[];
  selection: Set<number>;
  onRefresh: () => void;
}

export function ControlPanel({ chars, selection, onRefresh }: Props) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [structure, setStructure] = useState<FleetStructure | null>(null);
  const [targetKey, setTargetKey] = useState<string>('auto');

  const boss = chars.find(c => c.isBoss);
  const bossInFleet = boss?.fleetId != null;
  const bossIsFC = boss?.fleetRole === 'fleet_commander';

  // Fetch the fleet's wing/squad tree when the boss is FC of a fleet.
  useEffect(() => {
    if (!bossInFleet || !bossIsFC) { setStructure(null); return; }
    let cancelled = false;
    fetchFleetStructure().then(s => { if (!cancelled) setStructure(s); });
    return () => { cancelled = true; };
  }, [bossInFleet, bossIsFC, boss?.fleetId]);

  const selectedIds = Array.from(selection);
  const selectedCharsNonBoss = chars.filter(c => selection.has(c.characterId) && !c.isBoss && !c.needsReauth);
  const canInvite = !!boss && bossInFleet && bossIsFC && selectedCharsNonBoss.length > 0;

  const parsedTarget = (() => {
    if (targetKey === 'auto' || !structure) return undefined;
    const [w, s] = targetKey.split(':').map(Number);
    if (!Number.isFinite(w) || !Number.isFinite(s)) return undefined;
    return { wing_id: w, squad_id: s };
  })();

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
    else setResults(r.results);
  };

  return (
    <aside className="sidebar">
      <div>
        <h1>Legion of Wayne Manger</h1>
        <small>{chars.length} characters · {selection.size} selected</small>
      </div>

      <button className="primary" onClick={openAuth}>Add character</button>

      <AutopilotPanel selectedIds={selectedIds} />

      <div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>Fleet boss</div>
        <div style={{ fontSize: 14 }}>
          {boss ? boss.name : <span style={{ color: 'var(--dim)' }}>Click ★ on a row →</span>}
        </div>
        {boss && (
          <div style={{ fontSize: 12, marginTop: 4, color: bossInFleet && bossIsFC ? 'var(--green)' : 'var(--amber)' }}>
            {!bossInFleet && 'Not in a fleet — form one in-client.'}
            {bossInFleet && bossIsFC && `Fleet commander · fleet ${boss!.fleetId}`}
            {bossInFleet && !bossIsFC && (
              <>Currently {boss!.fleetRole ?? 'member'}. Drag this character to the <b>Fleet Commander</b> slot in-client.</>
            )}
          </div>
        )}
      </div>

      {structure && structure.wings.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>Invite target</div>
          <select
            value={targetKey}
            onChange={e => setTargetKey(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="auto">Auto (first wing / first squad)</option>
            {structure.wings.flatMap(w =>
              w.squads.length === 0
                ? []
                : w.squads.map(s => (
                    <option key={`${w.id}:${s.id}`} value={`${w.id}:${s.id}`}>
                      {w.name || `Wing ${w.id}`} / {s.name || `Squad ${s.id}`}
                    </option>
                  )),
            )}
          </select>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
            ESI can't see which squad the fleet marks as "default" — pick explicitly.
          </div>
        </div>
      )}

      <button className="primary" disabled={!canInvite || busy} onClick={doInviteAll}>
        {busy ? 'Inviting…' : `Invite selected (${selectedCharsNonBoss.length})`}
      </button>

      {error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>}

      {results && (
        <div className="results">
          <div style={{ fontSize: 12, color: 'var(--dim)' }}>Invite results</div>
          {results.map(r => (
            <div key={r.characterId} className="row">
              <span>{r.name}</span>
              <span className={r.ok ? 'ok' : 'err'}>{r.ok ? 'invited' : r.error}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1 }} />
      <small style={{ color: 'var(--dim)' }}>
        Watchlists: once every alt is in the boss's fleet, the in-game <b>Fleet Watchlist</b> auto-populates.
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

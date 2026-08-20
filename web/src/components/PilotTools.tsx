import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  searchSystems,
  setWaypointAll,
  type CharacterStatus,
  type CurrentUser,
  type SystemHit,
  type WaypointResult,
} from '../api.ts';

interface Props {
  chars: CharacterStatus[];
  selection: Set<number>;
  currentUser?: CurrentUser | null;
  onRefresh: () => void;
  onSetMainCharacter: (characterId: number | null) => void;
}

export function PilotTools({ chars, selection, currentUser, onRefresh, onSetMainCharacter }: Props) {
  const selectedIds = Array.from(selection);

  const openAuth = () => {
    const w = window.open('/auth/login', '_blank', 'width=560,height=720');
    const poll = setInterval(() => {
      if (!w || w.closed) {
        clearInterval(poll);
        setTimeout(onRefresh, 250);
      }
    }, 500);
  };

  return (
    <section className="pilot-tools" aria-label="Pilot tools">
      <div className="tool-widget-head">
        <div>
          <h2>Pilot tools</h2>
          <p>Authenticate pilots, choose your avatar, and send waypoints.</p>
        </div>
        <button className="primary" onClick={openAuth}>Add character</button>
      </div>

      {currentUser && chars.length > 0 && (
        <label className="main-pilot-control pilot-main-control">
          <span>Main pilot</span>
          <select
            className="main-pilot-select"
            value={currentUser.mainCharacterId ?? ''}
            onChange={e => onSetMainCharacter(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Choose a pilot</option>
            {chars.map(c => <option key={c.characterId} value={c.characterId}>{c.name}</option>)}
          </select>
        </label>
      )}

      <AutopilotPanel selectedIds={selectedIds} />
    </section>
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

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!hits.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => (i - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === 'Escape') {
      setHits([]);
    }
  };

  return (
    <div className="autopilot">
      <div className="autopilot-label">
        Set waypoint · {selectedIds.length ? `${selectedIds.length} selected` : 'all online'}
      </div>
      <input
        className="ap-input"
        type="text"
        placeholder="system name..."
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
        <div className="tool-widget-results">
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

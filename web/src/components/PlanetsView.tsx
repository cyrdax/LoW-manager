import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchColonyDetail,
  fetchInventory,
  fetchSavedSystems,
  fetchSystemPlanets,
  saveSystem,
  searchSystems,
  unsaveSystem,
  type CharacterStatus,
  type ColonyDetail,
  type ColonyInfo,
  type ExtractablePair,
  type InventoryItem,
  type SavedSystem,
  type SystemHit,
  type SystemPlanet,
  type SystemPlanetMyColony,
  type SystemPlanetsResponse,
} from '../api.ts';

interface Props { chars: CharacterStatus[] }

type SortKey = 'name' | 'colonies' | 'available' | 'expiry' | 'status';

function timeUntil(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function maxColonies(ipc: number | null): number {
  // Default colony allowance is 1; Interplanetary Consolidation adds one per level (max 5 → 6).
  return 1 + (ipc ?? 0);
}

function colonyStatus(c: CharacterStatus): { label: string; cls: string } {
  if (c.colonies.length === 0) return { label: 'no colonies', cls: 'dim' };
  if (c.hasIdlePi) return { label: 'IDLE', cls: 'err' };
  if (c.nextPiExpiry) {
    const ms = Date.parse(c.nextPiExpiry) - Date.now();
    if (ms < 6 * 60 * 60 * 1000) return { label: 'expiring soon', cls: 'warn' };
  }
  return { label: 'healthy', cls: 'ok' };
}

export function PlanetsView({ chars }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('expiry');
  const [sortAsc, setSortAsc] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const list = useMemo(() => {
    const arr = [...chars];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'colonies': cmp = a.colonies.length - b.colonies.length; break;
        case 'available': {
          const av = maxColonies(a.interplanetaryConsolidation) - a.colonies.length;
          const bv = maxColonies(b.interplanetaryConsolidation) - b.colonies.length;
          cmp = av - bv;
          break;
        }
        case 'expiry': {
          const ax = a.nextPiExpiry ? Date.parse(a.nextPiExpiry) : Number.POSITIVE_INFINITY;
          const bx = b.nextPiExpiry ? Date.parse(b.nextPiExpiry) : Number.POSITIVE_INFINITY;
          cmp = ax - bx;
          break;
        }
        case 'status': {
          const order = { IDLE: 0, 'expiring soon': 1, healthy: 2, 'no colonies': 3 } as Record<string, number>;
          cmp = (order[colonyStatus(a).label] ?? 4) - (order[colonyStatus(b).label] ?? 4);
          break;
        }
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [chars, sortKey, sortAsc]);

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  // Totals across all pilots
  const totalColonies = chars.reduce((n, c) => n + c.colonies.length, 0);
  const totalAvailable = chars.reduce(
    (n, c) => n + Math.max(0, maxColonies(c.interplanetaryConsolidation) - c.colonies.length),
    0,
  );
  const totalIdle = chars.reduce((n, c) => n + (c.hasIdlePi ? 1 : 0), 0);

  return (
    <main className="rows-wrap planets-view">
      <SavedPlanetsHost>
        {savedApi => (
          <>
            <SystemPlanetSearch savedApi={savedApi} />
            <SavedPlanetsPanel savedApi={savedApi} />
          </>
        )}
      </SavedPlanetsHost>
      <InventoryPanel />

      <div className="planets-header">
        <button className="sort-btn" onClick={() => onSort('name')}>
          Character {sortKey === 'name' && <span className="arrow">{sortAsc ? '▲' : '▼'}</span>}
        </button>
        <button className="sort-btn" onClick={() => onSort('colonies')}>
          Colonies <span className="total">{totalColonies}</span>
          {sortKey === 'colonies' && <span className="arrow">{sortAsc ? '▲' : '▼'}</span>}
        </button>
        <button className="sort-btn" onClick={() => onSort('available')}>
          Available {totalAvailable > 0 && <span className="total">{totalAvailable}</span>}
          {sortKey === 'available' && <span className="arrow">{sortAsc ? '▲' : '▼'}</span>}
        </button>
        <button className="sort-btn" onClick={() => onSort('expiry')}>
          Next expiry {sortKey === 'expiry' && <span className="arrow">{sortAsc ? '▲' : '▼'}</span>}
        </button>
        <button className="sort-btn" onClick={() => onSort('status')}>
          Status {totalIdle > 0 && <span className="total err">{totalIdle} idle</span>}
          {sortKey === 'status' && <span className="arrow">{sortAsc ? '▲' : '▼'}</span>}
        </button>
        <span />
      </div>

      {list.map(c => {
        const max = maxColonies(c.interplanetaryConsolidation);
        const status = colonyStatus(c);
        const isOpen = expanded.has(c.characterId);
        const underutilized = c.colonies.length < max;

        return (
          <div key={c.characterId} className={`prow planet-row${c.hasIdlePi ? ' has-idle' : ''}${isOpen ? ' open' : ''}`}>
            <div className="planet-summary">
              <img className="col-portrait" src={c.portraitUrl} alt="" width={32} height={32} />
              <div className="planet-name">
                <div className="title">{c.name}</div>
                {c.corporationTicker && <div className="corp">[{c.corporationTicker}]</div>}
              </div>
              <div className={`planet-colonies${underutilized ? ' under' : ''}`}>
                {c.colonies.length}/{max}
                {c.interplanetaryConsolidation === null && <span className="dim"> (loading)</span>}
              </div>
              <div className={`planet-available${underutilized ? ' under' : ''}`}>
                {c.interplanetaryConsolidation === null ? <span className="dim">—</span> : max - c.colonies.length}
              </div>
              <div className="planet-expiry">{timeUntil(c.nextPiExpiry)}</div>
              <div className={`planet-status ${status.cls}`}>{status.label}</div>
              <button
                className="expand-btn"
                onClick={() => toggleExpand(c.characterId)}
                disabled={c.colonies.length === 0}
                title={c.colonies.length === 0 ? 'No colonies to drill into' : isOpen ? 'Hide planets' : 'Show planets'}
              >
                {isOpen ? '▾' : '▸'}
              </button>
            </div>

            {isOpen && c.colonies.length > 0 && (
              <div className="planet-detail">
                {c.colonies.map(p => <ColonyRow key={p.planetId} characterId={c.characterId} p={p} />)}
              </div>
            )}
          </div>
        );
      })}

      {list.length === 0 && <div className="empty">No characters yet.</div>}
    </main>
  );
}

function ColonyRow({ characterId, p }: { characterId: number; p: ColonyInfo }) {
  const expired = p.hasIdle;
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ColonyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail && !busy) {
      setBusy(true);
      setError(null);
      const r = await fetchColonyDetail(characterId, p.planetId);
      setBusy(false);
      if ('error' in r) setError(r.error);
      else setDetail(r);
    }
  };

  return (
    <div className={`colony-row-wrap${open ? ' open' : ''}`}>
      <div className={`colony-row${expired ? ' idle' : ''}`} onClick={toggle} role="button">
        <div className="ctoggle">{open ? '▾' : '▸'}</div>
        <div className="ctype">{p.planetType}</div>
        <div className="csys">{p.solarSystemName ?? `#${p.solarSystemId}`}</div>
        <div className="cup">CC {p.upgradeLevel}</div>
        <div className="cpins">{p.numPins} pins</div>
        <div className="cexpiry">
          {p.soonestExpiry ? timeUntil(p.soonestExpiry) : '—'}
          {expired && <span className="badge err">idle</span>}
        </div>
      </div>
      {open && (
        <div className="colony-detail">
          {busy && <div className="dim">Loading…</div>}
          {error && <div className="err">{error}</div>}
          {detail && <ColonyDetailPanel d={detail} />}
        </div>
      )}
    </div>
  );
}

function ColonyDetailPanel({ d }: { d: ColonyDetail }) {
  return (
    <>
      {d.extractors.length > 0 && (
        <div className="cd-section">
          <div className="cd-h">Extractors ({d.extractors.length})</div>
          {d.extractors.map(e => {
            const expiredEx = e.expiryTime != null && Date.parse(e.expiryTime) <= Date.now();
            return (
              <div key={e.pinId} className={`cd-row${expiredEx ? ' idle' : ''}`}>
                <span className="cd-prod">{e.productName ?? e.typeName}</span>
                <span className="cd-meta">
                  {e.expiryTime ? `${expiredEx ? 'expired' : timeUntil(e.expiryTime)}` : '—'}
                </span>
                <span className="cd-meta dim">{e.cycleSeconds ? `${Math.round(e.cycleSeconds / 60)}m cycle` : ''}</span>
              </div>
            );
          })}
        </div>
      )}
      {d.factories.length > 0 && (
        <div className="cd-section">
          <div className="cd-h">Factories ({d.factories.length})</div>
          {d.factories.map(f => (
            <div key={f.pinId} className="cd-row">
              <span className="cd-prod">{f.schematicName ?? '—'}</span>
              <span className="cd-meta dim">{f.typeName}</span>
            </div>
          ))}
        </div>
      )}
      {d.storage.length > 0 && (
        <div className="cd-section">
          <div className="cd-h">Storage</div>
          {d.storage.map(s => (
            <div key={s.pinId} className="cd-storage">
              <div className="cd-storage-h dim">{s.typeName}</div>
              {s.contents.length === 0 ? (
                <div className="cd-empty dim">empty</div>
              ) : (
                <ul>
                  {s.contents.map(c => (
                    <li key={c.name}>
                      <span className={`cd-tier tier-${c.tier.toLowerCase().replace('+', 'plus')}`}>{c.tier}</span>
                      <span className="cd-iname">{c.name}</span>
                      <span className="cd-iamt">{c.amount.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {d.extractors.length + d.factories.length + d.storage.length === 0 && (
        <div className="dim">No active pins.</div>
      )}
    </>
  );
}

function InventoryPanel() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'P0' | 'P1' | 'P2' | 'P3+'>('all');

  const load = async () => {
    setBusy(true);
    const r = await fetchInventory();
    setBusy(false);
    setItems(r.items);
  };

  const onToggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !items) await load();
  };

  const visible = useMemo(() => {
    if (!items) return [];
    if (filter === 'all') return items;
    return items.filter(i => i.tier === filter);
  }, [items, filter]);

  const totals = useMemo(() => {
    const t: Record<string, number> = { P0: 0, P1: 0, P2: 0, 'P3+': 0 };
    if (items) for (const i of items) t[i.tier] += i.total;
    return t;
  }, [items]);

  return (
    <div className={`inv-panel${open ? ' open' : ''}`}>
      <button className="inv-h" onClick={onToggle}>
        <span>{open ? '▾' : '▸'}</span>
        <span>Fleet PI inventory</span>
        {items && (
          <span className="inv-totals">
            <span className="tier-p0">P0 {totals.P0.toLocaleString()}</span>
            <span className="tier-p1">P1 {totals.P1.toLocaleString()}</span>
            <span className="tier-p2">P2 {totals.P2.toLocaleString()}</span>
            {totals['P3+'] > 0 && <span className="tier-p3plus">P3+ {totals['P3+'].toLocaleString()}</span>}
          </span>
        )}
        <span className="inv-refresh" onClick={e => { e.stopPropagation(); load(); }} title="Refresh">↻</span>
      </button>

      {open && (
        <div className="inv-body">
          {busy && <div className="dim">Counting pins…</div>}
          {items && items.length === 0 && <div className="dim">No commodities found in storage.</div>}
          {items && items.length > 0 && (
            <>
              <div className="inv-filter">
                {(['all', 'P0', 'P1', 'P2', 'P3+'] as const).map(t => (
                  <button
                    key={t}
                    className={filter === t ? 'active' : ''}
                    onClick={() => setFilter(t)}
                  >{t}</button>
                ))}
              </div>
              <div className="inv-grid">
                {visible.map(i => (
                  <div key={i.name} className="inv-row">
                    <span className={`cd-tier tier-${i.tier.toLowerCase().replace('+', 'plus')}`}>{i.tier}</span>
                    <span className="inv-name">{i.name}</span>
                    <span className="inv-amt">{i.total.toLocaleString()}</span>
                    <span className="inv-where dim">{i.locations.length} location{i.locations.length === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface SavedApi {
  savedSet: Set<number>;
  saved: SavedSystem[];
  toggle: (systemId: number) => Promise<void>;
  reload: () => Promise<void>;
}

function SavedPlanetsHost({ children }: { children: (api: SavedApi) => React.ReactNode }) {
  const [saved, setSaved] = useState<SavedSystem[]>([]);

  const reload = useCallback(async () => {
    const list = await fetchSavedSystems();
    setSaved(list);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const savedSet = useMemo(() => new Set(saved.map(s => s.systemId)), [saved]);

  const toggle = useCallback(async (systemId: number) => {
    if (savedSet.has(systemId)) await unsaveSystem(systemId);
    else await saveSystem(systemId);
    await reload();
  }, [savedSet, reload]);

  return <>{children({ savedSet, saved, toggle, reload })}</>;
}

function SavedPlanetsPanel({ savedApi }: { savedApi: SavedApi }) {
  const [open, setOpen] = useState(false);
  if (savedApi.saved.length === 0) return null;
  const totalPlanets = savedApi.saved.reduce((n, s) => n + s.planets.length, 0);
  return (
    <div className={`saved-panel${open ? ' open' : ''}`}>
      <button className="saved-h" onClick={() => setOpen(o => !o)}>
        <span>{open ? '▾' : '▸'}</span>
        <span>Saved systems</span>
        <span className="saved-count">{savedApi.saved.length} · {totalPlanets} planets</span>
      </button>
      {open && (
        <div className="saved-body">
          {savedApi.saved.map(s => (
            <SystemPlanetBlock
              key={s.systemId}
              data={{
                system: { id: s.systemId, name: s.systemName, securityStatus: s.securityStatus },
                planets: s.planets,
              }}
              isSaved={savedApi.savedSet.has(s.systemId)}
              onToggleSave={() => savedApi.toggle(s.systemId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface PlanetInfoRowProps {
  planet: SystemPlanet;
}

function PlanetInfoRow({ planet: p }: PlanetInfoRowProps) {
  const owned = p.myColonies.length > 0;
  return (
    <div className={`ps-prow${owned ? ' owned' : ''}`}>
      <div className="ps-pname">{p.name}</div>
      <div className={`ps-ptype pt-${p.planetType}`}>{p.planetType}</div>
      <div className="ps-extract-inline">
        {p.extractables.map(e => (
          <span key={e.p0} className="ps-extract-chip">
            <span className="ps-p0">{e.p0}</span>
            <span className="ps-arrow">→</span>
            <span className="ps-p1">{e.p1}</span>
          </span>
        ))}
      </div>
      <div className="ps-pmine">
        {owned ? (
          <ul>
            {p.myColonies.map(c => (
              <li key={c.characterId} className={c.hasIdle ? 'idle' : ''}>
                <span className="who">{c.characterName}</span>
                <span className="meta">CC {c.upgradeLevel} · {c.numPins}p</span>
                <span className="meta">
                  {c.soonestExpiry ? timeUntil(c.soonestExpiry) : '—'}
                  {c.hasIdle && <span className="badge err">idle</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="dim">—</span>
        )}
      </div>
    </div>
  );
}

function SystemPlanetSearch({ savedApi }: { savedApi: SavedApi }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SystemHit[]>([]);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<SystemPlanetsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (abortRef.current) abortRef.current.abort();
    if (data && query === data.system.name) { setHits([]); return; }
    const ctl = new AbortController();
    abortRef.current = ctl;
    debounce.current = setTimeout(async () => {
      const r = await searchSystems(query, ctl.signal).catch(() => []);
      setHits(r);
      setActive(r.length > 0 ? 0 : -1);
    }, 120);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, data]);

  const pick = async (hit: SystemHit) => {
    setBusy(true);
    setError(null);
    setHits([]);
    setQuery(hit.name);
    const r = await fetchSystemPlanets(hit.id);
    setBusy(false);
    if ('error' in r) { setError(r.error); setData(null); }
    else setData(r);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(hits[active]); }
    else if (e.key === 'Escape') { setHits([]); }
  };

  const clear = () => { setQuery(''); setData(null); setError(null); setHits([]); };

  return (
    <div className="planet-search">
      <div className="planet-search-bar">
        <input
          className="ap-input"
          type="text"
          placeholder="Look up a system's planets…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        {(data || error || query) && (
          <button className="ps-clear" onClick={clear} title="Clear">✕</button>
        )}
        {hits.length > 0 && (
          <ul className="ap-suggestions ps-suggestions">
            {hits.map((h, i) => (
              <li key={h.id} className={i === active ? 'active' : ''} onMouseDown={() => pick(h)}>
                {h.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {busy && <div className="ps-status">Loading…</div>}
      {error && <div className="ps-status err">{error}</div>}

      {data && !busy && (
        <SystemPlanetBlock
          data={data}
          isSaved={savedApi.savedSet.has(data.system.id)}
          onToggleSave={() => savedApi.toggle(data.system.id)}
        />
      )}
    </div>
  );
}

function secClass(sec: number): string {
  if (sec >= 0.5) return 'sec-hi';
  if (sec > 0) return 'sec-lo';
  return 'sec-null';
}

function SystemPlanetBlock({ data, isSaved, onToggleSave }: {
  data: SystemPlanetsResponse;
  isSaved: boolean;
  onToggleSave: () => void;
}) {
  const ownedCount = data.planets.reduce((n, p) => n + p.myColonies.length, 0);

  // Group planet types for a quick at-a-glance summary
  const typeCounts: Record<string, number> = {};
  for (const p of data.planets) typeCounts[p.planetType] = (typeCounts[p.planetType] ?? 0) + 1;

  return (
    <div className="ps-results">
      <div className="ps-results-header">
        <div className="ps-system">
          <button
            className={`ps-save${isSaved ? ' on' : ''}`}
            onClick={onToggleSave}
            title={isSaved ? 'Remove from saved' : 'Save system'}
          >★</button>
          <strong>{data.system.name}</strong>
          <span className={`ps-sec ${secClass(data.system.securityStatus)}`}>
            {data.system.securityStatus.toFixed(1)}
          </span>
        </div>
        <div className="ps-summary">
          {data.planets.length} planets
          {ownedCount > 0 && <span className="ps-owned"> · {ownedCount} of yours</span>}
        </div>
      </div>

      <div className="ps-typesummary">
        {Object.entries(typeCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([t, n]) => (
            <span key={t} className={`ps-typetag pt-${t}`}>{t} <b>{n}</b></span>
          ))}
      </div>

      <div className="ps-planet-list">
        {data.planets.map(p => <PlanetInfoRow key={p.planetId} planet={p} />)}
      </div>
    </div>
  );
}

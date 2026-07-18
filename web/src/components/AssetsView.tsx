import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchAssets,
  refreshAllAssets,
  refreshPilotAssets,
  type AssetDashboard,
  type AssetLocationNode,
  type AssetSnapshot,
  type AssetTreeNode,
} from '../api.ts';

export function AssetsView() {
  const [dashboard, setDashboard] = useState<AssetDashboard | null>(null);
  const [pilots, setPilots] = useState<AssetSnapshot[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const refreshInFlight = useRef(false);
  const requestGeneration = useRef(0);
  const [expandedPilots, setExpandedPilots] = useState<Set<number>>(new Set());
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());
  const [expandedAssets, setExpandedAssets] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const generation = ++requestGeneration.current;
    fetchAssets()
      .then(result => {
        if (cancelled || generation !== requestGeneration.current) return;
        if ('error' in result) {
          setError(result.error);
          setLoadState('error');
        }
        else {
          setDashboard(result.dashboard);
          setPilots(result.pilots);
          setLoadState('ready');
        }
      })
      .catch(() => {
        if (!cancelled && generation === requestGeneration.current) {
          setError('Unable to load assets.');
          setLoadState('error');
        }
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => filterPilots(pilots, query, category), [pilots, query, category]);
  const refreshDisabled = busy != null || loadState === 'loading';

  const doRefreshAll = async () => {
    if (refreshInFlight.current || loadState === 'loading') return;
    refreshInFlight.current = true;
    const generation = ++requestGeneration.current;
    setBusy('all');
    setError(null);
    try {
      const result = await refreshAllAssets();
      if (generation !== requestGeneration.current) return;
      if ('error' in result) setError(result.error);
      else {
        setDashboard(result.dashboard);
        setPilots(result.pilots);
        setExpandedPilots(new Set(result.pilots.map(snapshot => snapshot.pilot.characterId)));
        setLoadState('ready');
      }
    } catch {
      if (generation === requestGeneration.current) setError('Unable to refresh assets.');
    } finally {
      refreshInFlight.current = false;
      setBusy(null);
    }
  };

  const doRefreshPilot = async (characterId: number) => {
    if (refreshInFlight.current || loadState === 'loading') return;
    refreshInFlight.current = true;
    const generation = ++requestGeneration.current;
    setBusy(String(characterId));
    setError(null);
    try {
      const result = await refreshPilotAssets(characterId);
      if (generation !== requestGeneration.current) return;
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setDashboard(result.dashboard);
      setPilots(current => current
        .filter(snapshot => snapshot.pilot.characterId !== result.snapshot.pilot.characterId)
        .concat(result.snapshot)
        .sort((a, b) => a.pilot.characterName.localeCompare(b.pilot.characterName)));
      setExpandedPilots(current => new Set(current).add(characterId));
      setLoadState('ready');
    } catch {
      if (generation === requestGeneration.current) setError('Unable to refresh pilot assets.');
    } finally {
      refreshInFlight.current = false;
      setBusy(null);
    }
  };

  return (
    <main className="assets-view">
      <section className="assets-dashboard" aria-label="Assets dashboard">
        <SummaryCard label="Total Estimated Value" value={dashboard ? formatIsk(dashboard.totalValue) : loadState === 'loading' ? 'Loading...' : 'Unavailable'} />
        <SummaryCard label="Priced Value" value={dashboard ? formatIsk(dashboard.pricedValue) : loadState === 'loading' ? 'Loading...' : 'Unavailable'} />
        <SummaryCard label="Unpriced Stacks" value={dashboard ? dashboard.unpricedStacks.toLocaleString() : loadState === 'loading' ? 'Loading...' : 'Unavailable'} />
        <SummaryCard label="Last Refresh" value={dashboard ? formatTime(dashboard.lastRefreshedAt) : loadState === 'loading' ? 'Loading...' : 'Unavailable'} />
        <button className={`asset-category-card${category === 'all' ? ' active' : ''}`} onClick={() => setCategory('all')}>
          <strong>All assets</strong>
          <span>{dashboard ? formatIsk(dashboard.totalValue) : loadState === 'loading' ? 'Loading...' : 'Unavailable'}</span>
        </button>
        {(dashboard?.categories ?? []).map(card => (
          <button key={card.key} className={`asset-category-card${category === card.key ? ' active' : ''}`} onClick={() => setCategory(card.key)}>
            <strong>{card.label}</strong>
            <span>{formatIsk(card.totalValue)}</span>
            <small>{card.itemCount.toLocaleString()} items · {card.stackCount.toLocaleString()} stacks</small>
          </button>
        ))}
      </section>

      <section className="assets-controls" aria-label="Assets controls">
        <button className="primary" onClick={doRefreshAll} disabled={refreshDisabled}>{busy === 'all' ? 'Refreshing...' : 'Refresh All'}</button>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search assets" aria-label="Search assets" />
        {category !== 'all' && <button onClick={() => setCategory('all')}>Clear filter</button>}
        {error && <span className="asset-error" role="alert">{error}</span>}
      </section>

      <section className="assets-tree" aria-label="Assets tree">
        <div className="assets-tree-content">
          <div className="assets-column-headings" aria-hidden="true">
            <span>Asset</span><span>Category</span><span>Quantity</span><span>Unit value</span><span>Total value</span><span>Price</span>
          </div>
          {loadState === 'loading' && <div className="assets-empty" role="status">Loading assets...</div>}
          {loadState === 'error' && <div className="assets-empty asset-load-error" role="alert">Unable to load assets. Try refreshing.</div>}
          {loadState === 'ready' && filtered.map(snapshot => (
            <PilotRow
              key={snapshot.pilot.characterId}
              snapshot={snapshot}
              busy={busy === String(snapshot.pilot.characterId)}
              refreshDisabled={refreshDisabled}
              expandedPilots={expandedPilots}
              expandedLocations={expandedLocations}
              expandedAssets={expandedAssets}
              setExpandedPilots={setExpandedPilots}
              setExpandedLocations={setExpandedLocations}
              setExpandedAssets={setExpandedAssets}
              onRefresh={doRefreshPilot}
            />
          ))}
          {loadState === 'ready' && filtered.length === 0 && <div className="assets-empty">No assets found.</div>}
        </div>
      </section>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="asset-summary-card"><span>{label}</span><strong>{value}</strong></div>;
}

function PilotRow(props: {
  snapshot: AssetSnapshot;
  busy: boolean;
  refreshDisabled: boolean;
  expandedPilots: Set<number>;
  expandedLocations: Set<string>;
  expandedAssets: Set<number>;
  setExpandedPilots: (fn: (current: Set<number>) => Set<number>) => void;
  setExpandedLocations: (fn: (current: Set<string>) => Set<string>) => void;
  setExpandedAssets: (fn: (current: Set<number>) => Set<number>) => void;
  onRefresh: (characterId: number) => void;
}) {
  const { snapshot } = props;
  const id = snapshot.pilot.characterId;
  const open = props.expandedPilots.has(id);
  return (
    <div className="asset-pilot">
      <div className="asset-pilot-head">
        <button className="asset-row asset-pilot-row" onClick={() => props.setExpandedPilots(current => toggled(current, id))} aria-expanded={open}>
          <span className="asset-disclosure">{open ? '▾' : '▸'}</span>
          <strong>{snapshot.pilot.characterName}</strong>
          <span>{snapshot.pilot.status}</span>
          <span>{formatIsk(snapshot.pilot.totalValue)}</span>
          <span>{snapshot.pilot.locationCount} locations</span>
          <span>{formatTime(snapshot.pilot.lastRefreshedAt)}</span>
        </button>
        <button className="asset-refresh-small" disabled={props.refreshDisabled} onClick={() => props.onRefresh(id)}>{props.busy ? 'Refreshing...' : 'Refresh'}</button>
      </div>
      {snapshot.pilot.error && <div className="asset-row-note">{snapshot.pilot.error}</div>}
      {open && snapshot.locations.map(location => (
        <LocationRow key={`${id}:${location.locationId}`} pilotId={id} location={location} {...props} />
      ))}
    </div>
  );
}

function LocationRow(props: {
  pilotId: number;
  location: AssetLocationNode;
  expandedLocations: Set<string>;
  expandedAssets: Set<number>;
  setExpandedLocations: (fn: (current: Set<string>) => Set<string>) => void;
  setExpandedAssets: (fn: (current: Set<number>) => Set<number>) => void;
}) {
  const key = `${props.pilotId}:${props.location.locationId}`;
  const open = props.expandedLocations.has(key);
  return (
    <div className="asset-location">
      <button className="asset-row asset-location-row" onClick={() => props.setExpandedLocations(current => toggled(current, key))} aria-expanded={open}>
        <span className="asset-disclosure">{open ? '▾' : '▸'}</span>
        <strong>{props.location.name}</strong>
        <span>{props.location.status === 'unresolved' ? `Unresolved: ${props.location.rawLocationId}` : props.location.type}</span>
        <span>{formatIsk(props.location.totalValue)}</span>
        <span>{props.location.stackCount} stacks</span>
      </button>
      {open && props.location.assets.map(asset => <AssetRow key={asset.itemId} asset={asset} depth={0} {...props} />)}
    </div>
  );
}

function AssetRow(props: {
  asset: AssetTreeNode;
  depth: number;
  expandedAssets: Set<number>;
  setExpandedAssets: (fn: (current: Set<number>) => Set<number>) => void;
}) {
  const hasChildren = props.asset.children.length > 0;
  const open = props.expandedAssets.has(props.asset.itemId);
  const blueprintLabel = props.asset.blueprintCopy ? ' Blueprint copy' : '';
  return (
    <div className="asset-node">
      <button
        className="asset-row asset-item-row"
        style={{ paddingLeft: 24 + props.depth * 18 }}
        onClick={() => hasChildren && props.setExpandedAssets(current => toggled(current, props.asset.itemId))}
        aria-expanded={hasChildren ? open : undefined}
      >
        <span className="asset-disclosure">{hasChildren ? (open ? '▾' : '▸') : ''}</span>
        <img src={`https://images.evetech.net/types/${props.asset.typeId}/icon?size=32`} alt="" />
        <strong>{props.asset.name}{blueprintLabel}</strong>
        <span>{props.asset.categoryLabel}</span>
        <span>{props.asset.quantity.toLocaleString()}</span>
        <span>{props.asset.unitValue == null ? 'Unpriced' : formatIsk(props.asset.unitValue)}</span>
        <span>{formatIsk(props.asset.stackValue)}</span>
        <span>{props.asset.pricingStatus}</span>
      </button>
      {open && props.asset.children.map(child => <AssetRow key={child.itemId} asset={child} depth={props.depth + 1} expandedAssets={props.expandedAssets} setExpandedAssets={props.setExpandedAssets} />)}
    </div>
  );
}

function toggled<T>(current: Set<T>, key: T): Set<T> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function formatIsk(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T ISK`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B ISK`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M ISK`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K ISK`;
  return `${Math.round(value).toLocaleString()} ISK`;
}

function formatTime(value: number | null): string {
  if (value == null) return 'Never';
  return new Date(value).toLocaleString();
}

function filterPilots(pilots: AssetSnapshot[], query: string, category: string): AssetSnapshot[] {
  const normalizedQuery = query.trim().toLowerCase();
  return pilots
    .map(snapshot => filterSnapshot(snapshot, normalizedQuery, category))
    .filter((snapshot): snapshot is AssetSnapshot => snapshot != null);
}

function filterSnapshot(snapshot: AssetSnapshot, query: string, category: string): AssetSnapshot | null {
  const pilotMatches = matches(snapshot.pilot.characterName, query);
  const locations = snapshot.locations
    .map(location => filterLocation(location, query, category, pilotMatches))
    .filter((location): location is AssetLocationNode => location != null);
  if (pilotMatches || locations.length > 0 || (query === '' && category === 'all')) return { ...snapshot, locations };
  return null;
}

function filterLocation(location: AssetLocationNode, query: string, category: string, parentMatches: boolean): AssetLocationNode | null {
  const selfMatches = parentMatches || matches(location.name, query);
  const assets = location.assets
    .map(asset => filterAsset(asset, query, category, selfMatches))
    .filter((asset): asset is AssetTreeNode => asset != null);
  if (selfMatches || assets.length > 0 || (query === '' && category === 'all')) return { ...location, assets };
  return null;
}

function filterAsset(asset: AssetTreeNode, query: string, category: string, parentMatches: boolean): AssetTreeNode | null {
  const categoryMatches = category === 'all' || asset.category === category;
  const selfMatches = parentMatches || matches(asset.name, query) || matches(asset.categoryLabel, query);
  const children = asset.children
    .map(child => filterAsset(child, query, category, selfMatches))
    .filter((child): child is AssetTreeNode => child != null);
  if ((selfMatches && categoryMatches) || children.length > 0 || (query === '' && categoryMatches)) return { ...asset, children };
  return null;
}

function matches(value: string, query: string): boolean {
  return query === '' || value.toLowerCase().includes(query);
}

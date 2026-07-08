import { useEffect, useMemo, useRef, useState } from 'react';
import {
  searchContractShips,
  searchContracts,
  searchSystems,
  type ContractSearchResponse,
  type ContractSearchResult,
  type ContractShipHit,
  type SystemHit,
} from '../api.ts';

const SHIP_ID_KEY = 'efd.contracts.shipId';
const SHIP_NAME_KEY = 'efd.contracts.shipName';
const SHIP_GROUP_KEY = 'efd.contracts.shipGroupName';
const ORIGIN_ID_KEY = 'efd.contracts.originSystemId';
const ORIGIN_NAME_KEY = 'efd.contracts.originSystemName';
const RADIUS_KEY = 'efd.contracts.radius';

function readSavedShip(): ContractShipHit | null {
  const id = Number(localStorage.getItem(SHIP_ID_KEY));
  const name = localStorage.getItem(SHIP_NAME_KEY);
  const groupName = localStorage.getItem(SHIP_GROUP_KEY);
  return Number.isFinite(id) && id > 0 && name && groupName ? { id, name, groupName } : null;
}

function readSavedOrigin(): SystemHit | null {
  const id = Number(localStorage.getItem(ORIGIN_ID_KEY));
  const name = localStorage.getItem(ORIGIN_NAME_KEY);
  return Number.isFinite(id) && id > 0 && name ? { id, name } : null;
}

function readSavedRadius(): number {
  const value = Number(localStorage.getItem(RADIUS_KEY) ?? 30);
  return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.round(value))) : 30;
}

export function ContractsView() {
  const [shipText, setShipText] = useState(() => localStorage.getItem(SHIP_NAME_KEY) ?? '');
  const [ship, setShip] = useState<ContractShipHit | null>(() => readSavedShip());
  const [shipHits, setShipHits] = useState<ContractShipHit[]>([]);
  const [originText, setOriginText] = useState(() => localStorage.getItem(ORIGIN_NAME_KEY) ?? '');
  const [origin, setOrigin] = useState<SystemHit | null>(() => readSavedOrigin());
  const [systemHits, setSystemHits] = useState<SystemHit[]>([]);
  const [radius, setRadius] = useState(() => readSavedRadius());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ContractSearchResponse | null>(null);
  const searchSeq = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (shipText.trim().length < 2 || ship?.name === shipText.trim()) {
      setShipHits([]);
      return;
    }
    const ctrl = new AbortController();
    searchContractShips(shipText, ctrl.signal).then(setShipHits).catch(() => {});
    return () => ctrl.abort();
  }, [shipText, ship]);

  useEffect(() => {
    if (originText.trim().length < 2 || origin?.name === originText.trim()) {
      setSystemHits([]);
      return;
    }
    const ctrl = new AbortController();
    searchSystems(originText, ctrl.signal).then(setSystemHits).catch(() => {});
    return () => ctrl.abort();
  }, [originText, origin]);

  useEffect(() => {
    if (!ship) {
      localStorage.removeItem(SHIP_ID_KEY);
      localStorage.removeItem(SHIP_NAME_KEY);
      localStorage.removeItem(SHIP_GROUP_KEY);
      return;
    }
    localStorage.setItem(SHIP_ID_KEY, String(ship.id));
    localStorage.setItem(SHIP_NAME_KEY, ship.name);
    localStorage.setItem(SHIP_GROUP_KEY, ship.groupName);
  }, [ship]);

  useEffect(() => {
    if (!origin) {
      localStorage.removeItem(ORIGIN_ID_KEY);
      localStorage.removeItem(ORIGIN_NAME_KEY);
      return;
    }
    localStorage.setItem(ORIGIN_ID_KEY, String(origin.id));
    localStorage.setItem(ORIGIN_NAME_KEY, origin.name);
  }, [origin]);

  useEffect(() => {
    localStorage.setItem(RADIUS_KEY, String(radius));
  }, [radius]);

  useEffect(() => {
    return () => {
      searchSeq.current += 1;
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
    };
  }, []);

  const canSearch = ship != null && origin != null && radius >= 1 && radius <= 100;

  const invalidateSearch = () => {
    searchSeq.current += 1;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setBusy(false);
  };

  const doSearch = async () => {
    if (!ship || !origin) return;
    searchAbortRef.current?.abort();
    const seq = ++searchSeq.current;
    const ctrl = new AbortController();
    searchAbortRef.current = ctrl;
    setBusy(true);
    setError(null);
    try {
      const result = await searchContracts(
        { shipId: ship.id, originSystemId: origin.id, radius },
        ctrl.signal,
      ).catch(err => ({ error: err instanceof Error ? err.message : 'Failed to search contracts' }));
      if (seq !== searchSeq.current) return;
      if ('error' in result) {
        setResponse(null);
        setError(result.error);
        return;
      }
      setResponse(result);
    } finally {
      if (seq === searchSeq.current) {
        setBusy(false);
        if (searchAbortRef.current === ctrl) {
          searchAbortRef.current = null;
        }
      }
    }
  };

  const summary = useMemo(() => {
    if (!response) return null;
    const knownJumps = response.results.filter(row => row.jumps != null).length;
    return `${response.results.length} contracts · ${knownJumps} with jumps · ${response.regionsScanned.length} regions`;
  }, [response]);

  return (
    <main className="rows-wrap contracts-view">
      <section className="ct-search" aria-label="Contracts search">
        <label className="ct-field" htmlFor="contracts-ship-input">
          <span>Ship</span>
          <input
            id="contracts-ship-input"
            value={shipText}
            placeholder="Type 2+ characters"
            autoComplete="off"
            onChange={e => {
              invalidateSearch();
              setShipText(e.target.value);
              setShip(null);
              setResponse(null);
              setError(null);
            }}
          />
          {shipHits.length > 0 && ship == null && (
            <div className="ct-suggest" role="listbox" aria-label="Ship suggestions">
              {shipHits.map(hit => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => {
                    setShip(hit);
                    setShipText(hit.name);
                    setShipHits([]);
                  }}
                >
                  <span>{hit.name}</span>
                  <small>{hit.groupName}</small>
                </button>
              ))}
            </div>
          )}
        </label>

        <label className="ct-field" htmlFor="contracts-origin-input">
          <span>Origin</span>
          <input
            id="contracts-origin-input"
            value={originText}
            placeholder="Start system"
            autoComplete="off"
            onChange={e => {
              invalidateSearch();
              setOriginText(e.target.value);
              setOrigin(null);
              setResponse(null);
              setError(null);
            }}
          />
          {systemHits.length > 0 && origin == null && (
            <div className="ct-suggest" role="listbox" aria-label="Origin system suggestions">
              {systemHits.map(hit => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => {
                    setOrigin(hit);
                    setOriginText(hit.name);
                    setSystemHits([]);
                  }}
                >
                  <span>{hit.name}</span>
                </button>
              ))}
            </div>
          )}
        </label>

        <label className="ct-field ct-radius" htmlFor="contracts-radius-input">
          <span>Jumps</span>
          <input
            id="contracts-radius-input"
            type="number"
            min={1}
            max={100}
            value={radius}
            onChange={e => {
              invalidateSearch();
              setRadius(Math.max(1, Math.min(100, Number(e.target.value) || 1)));
              setResponse(null);
              setError(null);
            }}
          />
        </label>

        <button
          className="primary ct-search-btn"
          type="button"
          disabled={!canSearch || busy}
          onClick={doSearch}
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </section>

      {error && <div className="ct-error">{error}</div>}

      {!response && !busy && !error && (
        <div className="empty">Pick a ship and origin system to search public contracts.</div>
      )}

      {response && (
        <>
          <section className="ct-summary" aria-label="Contracts summary">
            <strong>{response.ship.name}</strong>
            <span>{response.origin.name} · {response.radius} jumps</span>
            {summary && <span>{summary}</span>}
            <span>Updated {formatUpdatedAt(response.fetchedAt)}</span>
          </section>

          {response.warnings.length > 0 && (
            <div className="ct-warnings" aria-live="polite">
              {response.warnings.map(w => (
                <span key={`${w.code}-${w.count ?? 0}`}>
                  {w.message}
                  {w.count ? ` (${w.count})` : ''}
                </span>
              ))}
            </div>
          )}

          {response.results.length === 0 ? (
            <div className="empty">No matching public contracts found.</div>
          ) : (
            <ContractResultsTable rows={response.results} />
          )}
        </>
      )}
    </main>
  );
}

function ContractResultsTable({ rows }: { rows: ContractSearchResult[] }) {
  return (
    <div className="ct-table-wrap">
      <table className="ct-table">
        <thead>
          <tr>
            <th>Ship</th>
            <th>Type</th>
            <th className="num">Price</th>
            <th className="num">Qty</th>
            <th>Location</th>
            <th className="num">Jumps</th>
            <th>Expires</th>
            <th>Title</th>
            <th className="num">Contract</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.contractId}>
              <td>{row.shipName}</td>
              <td>{row.type === 'item_exchange' ? 'Item exchange' : 'Auction'}</td>
              <td className="num">{formatIsk(row.effectivePrice)}</td>
              <td className="num">{row.quantity.toLocaleString()}</td>
              <td>
                <div>{row.locationName}</div>
                <small>
                  {row.systemName ?? 'Unknown system'} · {row.regionName}
                  {!row.locationKnown ? ' · unresolved' : ''}
                </small>
              </td>
              <td className="num">{row.jumps == null ? 'null' : row.jumps}</td>
              <td>{formatExpiry(row.dateExpired)}</td>
              <td>{row.title || '—'}</td>
              <td className="num">{row.contractId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatIsk(value: number | null): string {
  if (value == null) return '—';
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

function formatUpdatedAt(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatExpiry(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const hours = Math.max(0, Math.round((ms - Date.now()) / 36e5));
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  fetchCharacters,
  fetchContractDetails,
  searchContractShips,
  searchContracts,
  searchJumpCapableContracts,
  searchSystems,
  setWaypointAll,
  type CharacterStatus,
  type ContractDetails,
  type ContractSearchResponse,
  type ContractSearchResult,
  type ContractShipHit,
  type ShoppingHub,
  type ShoppingItemQuote,
  type SystemHit,
  type WaypointResult,
} from '../api.ts';
import {
  sortContractResultsByColumn,
  type ContractResultSortKey,
  type SortDirection,
} from '../../../src/contracts/result-sort.ts';
import {
  sortContractDetailItems,
  type ContractDetailSortDirection,
  type ContractDetailSortKey,
} from '../contract-detail-sort.ts';

const SHIP_ID_KEY = 'efd.contracts.shipId';
const SHIP_NAME_KEY = 'efd.contracts.shipName';
const SHIP_GROUP_KEY = 'efd.contracts.shipGroupName';
const ORIGIN_ID_KEY = 'efd.contracts.originSystemId';
const ORIGIN_NAME_KEY = 'efd.contracts.originSystemName';
const RADIUS_KEY = 'efd.contracts.radius';
const SEARCH_MODE_KEY = 'efd.contracts.searchMode';

type ContractSearchMode = 'ship' | 'jumpCapable';

function readSavedSearchMode(): ContractSearchMode {
  return localStorage.getItem(SEARCH_MODE_KEY) === 'jumpCapable' ? 'jumpCapable' : 'ship';
}

function readSavedShip(): ContractShipHit | null {
  const id = Number(localStorage.getItem(SHIP_ID_KEY));
  const name = localStorage.getItem(SHIP_NAME_KEY);
  const groupName = localStorage.getItem(SHIP_GROUP_KEY);
  return Number.isFinite(id) && id > 0 && name && groupName ? { id, name, groupName, jumpDriveBaseRangeLy: null } : null;
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
  const [searchMode, setSearchMode] = useState<ContractSearchMode>(() => readSavedSearchMode());
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
  const [detailRow, setDetailRow] = useState<ContractSearchResult | null>(null);
  const searchSeq = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (searchMode === 'jumpCapable' || shipText.trim().length < 2 || ship?.name === shipText.trim()) {
      setShipHits([]);
      return;
    }
    const ctrl = new AbortController();
    searchContractShips(shipText, ctrl.signal).then(setShipHits).catch(() => {});
    return () => ctrl.abort();
  }, [searchMode, shipText, ship]);

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
    localStorage.setItem(SEARCH_MODE_KEY, searchMode);
  }, [searchMode]);

  useEffect(() => {
    return () => {
      searchSeq.current += 1;
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
    };
  }, []);

  const canSearch = origin != null && (
    searchMode === 'jumpCapable'
      || (ship != null && radius >= 1 && radius <= 100)
  );

  const invalidateSearch = () => {
    searchSeq.current += 1;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setBusy(false);
    setDetailRow(null);
  };

  const doSearch = async () => {
    if (!origin || (searchMode === 'ship' && !ship)) return;
    searchAbortRef.current?.abort();
    const seq = ++searchSeq.current;
    const ctrl = new AbortController();
    searchAbortRef.current = ctrl;
    setBusy(true);
    setError(null);
    try {
      const result = await (
        searchMode === 'jumpCapable'
          ? searchJumpCapableContracts({ originSystemId: origin.id }, ctrl.signal)
          : searchContracts({ shipId: ship!.id, originSystemId: origin.id, radius }, ctrl.signal)
      ).catch(err => {
        return { error: err instanceof Error ? err.message : 'Failed to search contracts' };
      });
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

  const indexSummary = useMemo(() => {
    if (!response) return null;
    const index = response.index;
    if (index.complete) return `Index ready · ${index.regionsReady}/${index.regionsTotal} regions`;
    return `Index warming · ${index.regionsReady}/${index.regionsTotal} regions ready`;
  }, [response]);

  return (
    <main className="rows-wrap contracts-view">
      <section className="ct-search" aria-label="Contracts search">
        <div className="ct-mode-toggle" role="group" aria-label="Contract search mode">
          <button
            type="button"
            className={searchMode === 'ship' ? 'active' : ''}
            onClick={() => {
              invalidateSearch();
              setSearchMode('ship');
              setResponse(null);
              setError(null);
            }}
          >
            Ship
          </button>
          <button
            type="button"
            className={searchMode === 'jumpCapable' ? 'active' : ''}
            onClick={() => {
              invalidateSearch();
              setSearchMode('jumpCapable');
              setShipHits([]);
              setResponse(null);
              setError(null);
            }}
          >
            Any cap jump
          </button>
          {searchMode === 'jumpCapable' && <small>Within 1 JDC V cap jump</small>}
        </div>

        <label className="ct-field" htmlFor="contracts-ship-input">
          <span>Ship</span>
          <input
            id="contracts-ship-input"
            value={searchMode === 'jumpCapable' ? 'Any jump-capable ship' : shipText}
            placeholder={searchMode === 'jumpCapable' ? 'Any jump-capable ship' : 'Type 2+ characters'}
            autoComplete="off"
            disabled={searchMode === 'jumpCapable' || busy}
            onChange={e => {
              if (searchMode === 'jumpCapable') return;
              invalidateSearch();
              setShipText(e.target.value);
              setShip(null);
              setResponse(null);
              setError(null);
            }}
          />
          {searchMode === 'ship' && shipHits.length > 0 && ship == null && (
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
            disabled={searchMode === 'jumpCapable'}
            onChange={e => {
              if (searchMode === 'jumpCapable') return;
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
            {indexSummary && <span>{indexSummary}</span>}
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
            <ContractResultsTable rows={response.results} onOpenDetails={setDetailRow} />
          )}
        </>
      )}

      {detailRow && (
        <ContractDetailsModal row={detailRow} onClose={() => setDetailRow(null)} />
      )}
    </main>
  );
}

function ContractResultsTable({
  rows,
  onOpenDetails,
}: {
  rows: ContractSearchResult[];
  onOpenDetails: (row: ContractSearchResult) => void;
}) {
  const [sort, setSort] = useState<{ key: ContractResultSortKey; direction: SortDirection } | null>(null);
  const sortedRows = useMemo(
    () => sort ? sortContractResultsByColumn(rows, sort.key, sort.direction) : rows,
    [rows, sort],
  );
  const onSort = (key: ContractResultSortKey) => {
    setSort(current => {
      if (current?.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };
  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: ContractSearchResult) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpenDetails(row);
  };

  return (
    <div className="ct-table-wrap">
      <table className="ct-table">
        <thead>
          <tr>
            <SortableTh label="Ship" sortKey="ship" active={sort} onSort={onSort} />
            <SortableTh label="Type" sortKey="type" active={sort} onSort={onSort} />
            <SortableTh label="Price" sortKey="price" active={sort} onSort={onSort} numeric />
            <SortableTh label="Qty" sortKey="quantity" active={sort} onSort={onSort} numeric />
            <SortableTh label="Location" sortKey="location" active={sort} onSort={onSort} />
            <SortableTh label="Jumps" sortKey="jumps" active={sort} onSort={onSort} numeric />
            <SortableTh label="Cap jumps" sortKey="capitalJumps" active={sort} onSort={onSort} numeric />
            <SortableTh label="Expires" sortKey="expires" active={sort} onSort={onSort} />
            <SortableTh label="Title" sortKey="title" active={sort} onSort={onSort} />
            <SortableTh label="Contract" sortKey="contract" active={sort} onSort={onSort} numeric />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(row => (
            <tr
              key={row.contractId}
              className="ct-row-clickable"
              tabIndex={0}
              role="button"
              onClick={() => onOpenDetails(row)}
              onKeyDown={event => onRowKeyDown(event, row)}
              aria-label={`Open contract ${row.contractId} details`}
            >
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
              <td className="num">{row.jumps == null ? '—' : row.jumps}</td>
              <td className="num">{row.capitalJumps == null ? 'N/A' : row.capitalJumps}</td>
              <td>{formatExpiry(row.dateExpired)}</td>
              <td>{row.title || '—'}</td>
              <td className="num">
                <button className="ct-contract-link" type="button" onClick={event => {
                  event.stopPropagation();
                  onOpenDetails(row);
                }}>
                  {row.contractId}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContractDetailsModal({ row, onClose }: { row: ContractSearchResult; onClose: () => void }) {
  const [hub, setHub] = useState<ShoppingHub>('jita');
  const [details, setDetails] = useState<ContractDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [destinationPilots, setDestinationPilots] = useState<CharacterStatus[]>([]);
  const [selectedDestinationPilotId, setSelectedDestinationPilotId] = useState<number | null>(null);
  const [destinationBusy, setDestinationBusy] = useState(false);
  const [destinationStatus, setDestinationStatus] = useState<string | null>(null);
  const [destinationResults, setDestinationResults] = useState<WaypointResult[] | null>(null);
  const [detailSort, setDetailSort] = useState<{ key: ContractDetailSortKey; direction: ContractDetailSortDirection }>({
    key: 'item',
    direction: 'asc',
  });

  useEffect(() => {
    let active = true;
    fetchCharacters().then(pilots => {
      if (!active) return;
      const sorted = [...pilots].sort((a, b) => a.name.localeCompare(b.name));
      setDestinationPilots(sorted);
      setSelectedDestinationPilotId(current => current ?? sorted[0]?.characterId ?? null);
    }).catch(() => {
      if (active) setDestinationStatus('Failed to load pilots.');
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchContractDetails(row.contractId, hub, ctrl.signal).then(result => {
      if (ctrl.signal.aborted) return;
      if ('error' in result) {
        setDetails(null);
        setError(result.error);
      } else {
        setDetails(result);
      }
    }).catch(err => {
      if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : 'Failed to load contract details');
    }).finally(() => {
      if (!ctrl.signal.aborted) setLoading(false);
    });
    return () => ctrl.abort();
  }, [row.contractId, hub]);

  const quoteByType = useMemo(() => {
    const byType = new Map<number, ShoppingItemQuote>();
    if (!details) return byType;
    for (const item of details.quote.items) {
      if (item.typeId != null) byType.set(item.typeId, item);
    }
    return byType;
  }, [details]);

  const estimateDelta = details ? details.contract.effectivePrice == null ? null : details.contract.effectivePrice - details.quote.totalCost : null;
  const sortedDetailItems = useMemo(
    () => details ? sortContractDetailItems(details.items, quoteByType, detailSort.key, detailSort.direction) : [],
    [details, quoteByType, detailSort],
  );
  const onDetailSort = (key: ContractDetailSortKey) => {
    setDetailSort(current => (
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: defaultContractDetailSortDirection(key) }
    ));
  };
  const setContractDestination = async () => {
    if (!details?.contract.locationId || selectedDestinationPilotId == null) return;
    setDestinationBusy(true);
    setDestinationStatus(null);
    setDestinationResults(null);
    try {
      const result = await setWaypointAll(details.contract.locationId, [selectedDestinationPilotId]);
      setDestinationResults(result.results);
      const success = result.results.find(item => item.ok);
      const failure = result.results.find(item => !item.ok);
      setDestinationStatus(success ? `Destination set for ${success.name}.` : failure?.error ?? 'Failed to set destination.');
    } catch (err) {
      setDestinationStatus(err instanceof Error ? err.message : 'Failed to set destination.');
    } finally {
      setDestinationBusy(false);
    }
  };

  return (
    <Modal title="Contract Price Breakdown" onClose={onClose} className="ct-detail-modal" bodyClassName="ct-detail-modal-body">
      <div className="ct-detail">
        <div className="ct-detail-head">
          <div>
            <strong>{row.shipName}</strong>
            <span>{row.title || `Contract ${row.contractId}`}</span>
          </div>
          <div className="ct-hub-switch" role="group" aria-label="Pricing hub">
            <button type="button" className={hub === 'jita' ? 'active' : ''} onClick={() => setHub('jita')}>Jita</button>
            <button type="button" className={hub === 'amarr' ? 'active' : ''} onClick={() => setHub('amarr')}>Amarr</button>
          </div>
        </div>

        {loading && <div className="empty">Loading contract items...</div>}
        {error && <div className="ct-error">{error}</div>}

        {details && (
          <>
            <div className="ct-detail-grid">
              <DetailMetric label="Contract" value={`${formatIsk(details.contract.effectivePrice)} ISK`} />
              <DetailMetric label={`${details.quote.systemName} estimate`} value={`${formatIsk(details.quote.totalCost)} ISK`} strong />
              <DetailMetric label="Difference" value={estimateDelta == null ? '-' : `${formatSignedIsk(estimateDelta)} ISK`} />
              <DetailMetric label="Pricing" value={`${details.quote.counts.ok} priced · ${details.quote.counts.noOrders} no sellers`} />
            </div>

            <section className="ct-destination" aria-label="Set contract destination">
              <div>
                <strong>Set destination</strong>
                <span>{details.contract.locationName} · {details.contract.systemName ?? 'Unknown system'}</span>
              </div>
              <div className="ct-destination-controls">
                <select
                  value={selectedDestinationPilotId ?? ''}
                  disabled={destinationBusy || destinationPilots.length === 0}
                  onChange={event => {
                    setSelectedDestinationPilotId(event.target.value ? Number(event.target.value) : null);
                    setDestinationStatus(null);
                    setDestinationResults(null);
                  }}
                >
                  {destinationPilots.length === 0 ? (
                    <option value="">No pilots available</option>
                  ) : destinationPilots.map(pilot => (
                    <option key={pilot.characterId} value={pilot.characterId}>
                      {pilot.name}{pilot.online === true ? ' · online' : pilot.online === false ? ' · offline' : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="primary"
                  disabled={destinationBusy || !details.contract.locationId || selectedDestinationPilotId == null}
                  onClick={setContractDestination}
                >
                  {destinationBusy ? 'Setting...' : 'Set destination'}
                </button>
              </div>
              {!details.contract.locationId && (
                <small className="err">This contract location is unresolved, so it cannot be set as a destination.</small>
              )}
              {destinationStatus && (
                <small className={destinationResults?.some(item => item.ok) ? 'ok' : 'err'}>{destinationStatus}</small>
              )}
              {destinationResults && (
                <div className="ct-destination-results">
                  {destinationResults.map(result => (
                    <span key={result.characterId} className={result.ok ? 'ok' : 'err'}>
                      {result.name}: {result.ok ? 'waypoint set' : result.error ?? 'failed'}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section className="ct-detail-items">
              <h3>Included items <span>{details.items.length}</span></h3>
              <div className="ct-detail-table">
                <div className="ct-detail-row ct-detail-row-head">
                  <ContractDetailSortTh label="Item" sortKey="item" active={detailSort} onSort={onDetailSort} />
                  <ContractDetailSortTh label="Category" sortKey="category" active={detailSort} onSort={onDetailSort} />
                  <ContractDetailSortTh label="Qty" sortKey="quantity" active={detailSort} onSort={onDetailSort} numeric />
                  <ContractDetailSortTh label="Unit" sortKey="unit" active={detailSort} onSort={onDetailSort} numeric />
                  <ContractDetailSortTh label="Total" sortKey="total" active={detailSort} onSort={onDetailSort} numeric />
                  <ContractDetailSortTh label="Status" sortKey="status" active={detailSort} onSort={onDetailSort} />
                </div>
                {sortedDetailItems.map(item => {
                  const quote = quoteByType.get(item.typeId) ?? null;
                  return (
                    <div className="ct-detail-row" key={item.recordId}>
                      <span className="ct-detail-item">
                        <img src={iconUrl(item.typeId)} alt="" />
                        <b title={item.name}>{item.name}</b>
                      </span>
                      <span>{item.groupName}</span>
                      <span>{item.quantity.toLocaleString()}</span>
                      <span>{quote?.avgPrice == null ? '-' : `${formatIsk(quote.avgPrice)} ISK`}</span>
                      <span>{formatIsk(quote?.totalCost ?? 0)} ISK</span>
                      <small className={quote?.status ?? 'unknown-item'}>{quoteStatus(quote)}</small>
                    </div>
                  );
                })}
              </div>
              <div className="ct-detail-total">
                <span>Total estimate</span>
                <b>{formatIsk(details.quote.totalCost)} ISK</b>
              </div>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function DetailMetric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={strong ? 'strong' : ''}><span>{label}</span><b>{value}</b></div>;
}

function ContractDetailSortTh({
  label,
  sortKey,
  active,
  onSort,
  numeric = false,
}: {
  label: string;
  sortKey: ContractDetailSortKey;
  active: { key: ContractDetailSortKey; direction: ContractDetailSortDirection };
  onSort: (key: ContractDetailSortKey) => void;
  numeric?: boolean;
}) {
  const direction = active.key === sortKey ? active.direction : null;
  return (
    <span
      className={numeric ? 'num' : undefined}
      role="columnheader"
      aria-sort={direction ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={`ct-detail-sort-btn${direction ? ' active' : ''}`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        {direction && <span className="arrow" aria-hidden="true">{direction === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </span>
  );
}

function defaultContractDetailSortDirection(key: ContractDetailSortKey): ContractDetailSortDirection {
  return key === 'item' || key === 'category' || key === 'status' ? 'asc' : 'desc';
}

function Modal({
  title,
  children,
  onClose,
  className = '',
  bodyClassName = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className="fits-modal-backdrop">
      <div className={`fits-modal${className ? ` ${className}` : ''}`}>
        <div className="fits-modal-head"><strong>{title}</strong><button onClick={onClose}>x</button></div>
        <div className={`fits-modal-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
      </div>
    </div>
  );
}

function quoteStatus(quote: ShoppingItemQuote | null): string {
  if (!quote) return 'Not priced';
  if (quote.status === 'ok') return 'Priced';
  if (quote.status === 'partial') return `Partial (${quote.shortfall.toLocaleString()} short)`;
  if (quote.status === 'no-orders') return 'No sellers';
  return 'Unknown item';
}

function iconUrl(typeId: number): string {
  return `https://images.evetech.net/types/${typeId}/icon?size=64`;
}

function SortableTh({
  label,
  sortKey,
  active,
  onSort,
  numeric = false,
}: {
  label: string;
  sortKey: ContractResultSortKey;
  active: { key: ContractResultSortKey; direction: SortDirection } | null;
  onSort: (key: ContractResultSortKey) => void;
  numeric?: boolean;
}) {
  const selected = active?.key === sortKey;
  return (
    <th
      className={numeric ? 'num' : undefined}
      aria-sort={selected ? (active.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button className="sort-btn" type="button" onClick={() => onSort(sortKey)}>
        {label}
        {selected && <span className="arrow">{active.direction === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
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

function formatSignedIsk(value: number): string {
  if (value === 0) return '0';
  const prefix = value > 0 ? '+' : '-';
  return `${prefix}${formatIsk(Math.abs(value))}`;
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

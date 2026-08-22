import { useEffect, useMemo, useState } from 'react';
import { fetchFit, fetchFits, searchFitItems, searchFitShips, type CurrentUser, type FitItemHit, type FitShipHit, type LibraryVisibility, type SavedFitDetail, type SavedFitSummary } from '../api.ts';

interface Props {
  currentUser?: CurrentUser | null;
  visibility: LibraryVisibility;
  routeFitId: number | null;
  onOpenFitRoute: (id: number) => void;
}

export function FitsV2View({ currentUser, visibility, routeFitId, onOpenFitRoute }: Props) {
  const [fits, setFits] = useState<SavedFitSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(routeFitId);
  const [detail, setDetail] = useState<SavedFitDetail | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [hullQuery, setHullQuery] = useState('');
  const [hullHits, setHullHits] = useState<FitShipHit[]>([]);
  const [itemQuery, setItemQuery] = useState('');
  const [itemHits, setItemHits] = useState<FitItemHit[]>([]);

  useEffect(() => { setSelectedId(routeFitId); }, [routeFitId]);

  useEffect(() => {
    let cancelled = false;
    fetchFits(visibility).then(rows => {
      if (cancelled) return;
      setFits(rows);
      if (routeFitId == null && rows[0]) {
        setSelectedId(rows[0].id);
        onOpenFitRoute(rows[0].id);
      }
    });
    return () => { cancelled = true; };
  }, [visibility, routeFitId, onOpenFitRoute]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setStatus('Loading fit...');
    fetchFit(selectedId).then(result => {
      if (cancelled) return;
      if ('error' in result) {
        setDetail(null);
        setStatus(result.error);
      } else {
        setDetail(result);
        setStatus(null);
      }
    });
    return () => { cancelled = true; };
  }, [selectedId]);

  useEffect(() => {
    const query = hullQuery.trim();
    if (query.length < 2) {
      setHullHits([]);
      return;
    }
    const controller = new AbortController();
    searchFitShips(query, controller.signal).then(setHullHits).catch(() => {});
    return () => controller.abort();
  }, [hullQuery]);

  useEffect(() => {
    const query = itemQuery.trim();
    if (query.length < 2) {
      setItemHits([]);
      return;
    }
    const controller = new AbortController();
    searchFitItems(query, controller.signal).then(setItemHits).catch(() => {});
    return () => controller.abort();
  }, [itemQuery]);

  const activeFit = useMemo(() => fits.find(fit => fit.id === selectedId) ?? null, [fits, selectedId]);

  function openFit(id: number) {
    setSelectedId(id);
    onOpenFitRoute(id);
  }

  return (
    <section className="fits-v2-view">
      <aside className="fits-v2-sidebar">
        <div className="fits-v2-panel-head">
          <div>
            <h2>Fits v2</h2>
            <p>{visibility === 'public' ? 'Public library' : 'Private library'}</p>
          </div>
          {!currentUser && <span className="fit-pill">Public</span>}
        </div>
        <input
          className="fits-v2-search"
          value={hullQuery}
          onChange={event => setHullQuery(event.target.value)}
          placeholder="Search hulls to start"
        />
        {hullHits.length > 0 && (
          <div className="fits-v2-hull-results">
            {hullHits.slice(0, 6).map(hit => (
              <button key={hit.id} type="button">
                <span>{hit.name}</span>
                <small>{hit.groupName}</small>
              </button>
            ))}
          </div>
        )}
        <input
          className="fits-v2-search"
          value={itemQuery}
          onChange={event => setItemQuery(event.target.value)}
          placeholder="Search modules, drones, cargo"
        />
        {itemHits.length > 0 && (
          <div className="fits-v2-hull-results">
            {itemHits.slice(0, 8).map(hit => (
              <button key={hit.id} type="button">
                <span>{hit.name}</span>
                <small>{hit.categoryName} / {hit.groupName}{hit.role ? ` / ${hit.role}` : ''}</small>
              </button>
            ))}
          </div>
        )}
        <div className="fits-v2-list">
          {fits.map(fit => (
            <button key={fit.id} className={fit.id === selectedId ? 'active' : ''} type="button" onClick={() => openFit(fit.id)}>
              <img src={`https://images.evetech.net/types/${fit.shipTypeId}/icon?size=64`} alt="" />
              <span>
                <strong>{fit.shipName}</strong>
                <small>{fit.fitName}</small>
              </span>
              {fit.hasEditorJson && <em>v2</em>}
            </button>
          ))}
          {fits.length === 0 && <div className="empty">No saved fits in this library yet.</div>}
        </div>
      </aside>
      <div className="fits-v2-workbench">
        <div className="fits-v2-hero">
          {activeFit && <img src={`https://images.evetech.net/types/${activeFit.shipTypeId}/render?size=256`} alt="" />}
          <div>
            <p className="eyebrow">Dogma editor foundation</p>
            <h1>{detail?.ship?.name ?? activeFit?.shipName ?? 'Choose a hull'}</h1>
            <p>{detail?.fitName ?? activeFit?.fitName ?? 'Search for a ship or choose a saved fit to begin.'}</p>
          </div>
        </div>
        {status && <div className="banner warn">{status}</div>}
        {detail && (
          <div className="fits-v2-card-grid">
            <section className="fits-v2-card">
              <h3>Editor payload</h3>
              <p>{detail.editorJson ? 'Stored Fits v2 state is attached to this fit.' : 'This legacy fit will be converted from EFT when opened in the full editor.'}</p>
            </section>
            <section className="fits-v2-card">
              <h3>Slots</h3>
              <p>{detail.layout ? `${detail.layout.highSlots} high / ${detail.layout.midSlots} mid / ${detail.layout.lowSlots} low / ${detail.layout.rigSlots} rig` : 'Layout unavailable'}</p>
            </section>
            <section className="fits-v2-card">
              <h3>Skill profile</h3>
              <p>{detail.editorJson?.skillProfile.name ?? 'All V default'}</p>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}

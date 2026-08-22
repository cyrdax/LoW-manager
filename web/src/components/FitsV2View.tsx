import { useEffect, useMemo, useState } from 'react';
import { fetchFit, fetchFits, saveFit, searchFitItems, searchFitShips, updateFit, type AssignedFitItem, type CurrentUser, type FitItemHit, type FitSectionRole, type FitShipHit, type FitsV2EditorDocument, type FitsV2EditorItem, type LibraryVisibility, type SavedFitDetail, type SavedFitSummary } from '../api.ts';

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
  const [editor, setEditor] = useState<FitsV2EditorDocument | null>(null);
  const [fitName, setFitName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
        const nextEditor = result.editorJson ?? editorDocumentFromSavedFit(result);
        setEditor(nextEditor);
        setFitName(nextEditor.fitName);
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

  function startHull(hit: FitShipHit) {
    const nextEditor: FitsV2EditorDocument = {
      version: 1,
      hull: { typeId: hit.id, name: hit.name, groupId: 0, groupName: hit.groupName },
      fitName: `${hit.name} fit`,
      notes: '',
      skillProfile: { kind: 'all-v', characterId: null, name: 'All V' },
      items: [],
    };
    setSelectedId(null);
    setDetail(null);
    setEditor(nextEditor);
    setFitName(nextEditor.fitName);
    setStatus(null);
    setSaveStatus(null);
  }

  function addItem(hit: FitItemHit) {
    if (!editor) {
      setSaveStatus('Choose a hull before adding items.');
      return;
    }
    const role = hit.role ?? firstAvailableSlotRole(editor);
    const nextItem: FitsV2EditorItem = {
      editorItemId: `${Date.now()}-${hit.id}`,
      typeId: hit.id,
      name: hit.name,
      role,
      quantity: role === 'extras' || role === 'droneBay' || role === 'fighterBay' ? 1 : 1,
      slotIndex: slotIndexFor(editor.items, role),
      state: 'offline',
      chargeTypeId: null,
      chargeName: null,
    };
    setEditor({ ...editor, items: [...editor.items, nextItem] });
    setSaveStatus(null);
  }

  function removeItem(editorItemId: string) {
    if (!editor) return;
    setEditor({ ...editor, items: editor.items.filter(item => item.editorItemId !== editorItemId) });
  }

  function updateQuantity(editorItemId: string, quantity: number) {
    if (!editor) return;
    setEditor({
      ...editor,
      items: editor.items.map(item => item.editorItemId === editorItemId ? { ...item, quantity: Math.max(1, Math.floor(quantity) || 1) } : item),
    });
  }

  async function saveEditor() {
    if (!currentUser) {
      setSaveStatus('Log in to save Fits v2 changes.');
      return;
    }
    if (!editor) {
      setSaveStatus('Choose a hull before saving.');
      return;
    }
    const namedEditor = { ...editor, fitName: fitName.trim() || editor.fitName };
    const rawEft = renderEditorToEft(namedEditor);
    setSaving(true);
    setSaveStatus(null);
    const result = detail
      ? await updateFit(detail.id, { rawEft, fitName: namedEditor.fitName, notes: namedEditor.notes, editorJson: namedEditor })
      : await saveFit({ rawEft, fitName: namedEditor.fitName, notes: namedEditor.notes, visibility, editorJson: namedEditor });
    setSaving(false);
    if ('error' in result) {
      setSaveStatus(result.error);
      return;
    }
    setDetail(result);
    setEditor(result.editorJson);
    setFitName(result.fitName);
    setSaveStatus('Saved.');
    onOpenFitRoute(result.id);
    const rows = await fetchFits(visibility);
    setFits(rows);
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
              <button key={hit.id} type="button" onClick={() => startHull(hit)}>
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
              <button key={hit.id} type="button" onClick={() => addItem(hit)}>
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
          {(editor || activeFit) && <img src={`https://images.evetech.net/types/${editor?.hull.typeId ?? activeFit?.shipTypeId}/render?size=256`} alt="" />}
          <div>
            <p className="eyebrow">Dogma editor foundation</p>
            <h1>{editor?.hull.name ?? detail?.ship?.name ?? activeFit?.shipName ?? 'Choose a hull'}</h1>
            {editor
              ? <input value={fitName} onChange={event => setFitName(event.target.value)} aria-label="Fit name" />
              : <p>Search for a ship or choose a saved fit to begin.</p>}
          </div>
        </div>
        {status && <div className="banner warn">{status}</div>}
        {editor && (
          <div className="fits-v2-editor-actions">
            <button onClick={saveEditor} disabled={saving}>{saving ? 'Saving...' : detail ? 'Save changes' : 'Save fit'}</button>
            {saveStatus && <span>{saveStatus}</span>}
          </div>
        )}
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
        {editor && (
          <div className="fits-v2-editor-grid">
            {EDITOR_ROLE_ORDER.map(role => (
              <section key={role} className="fits-v2-card">
                <h3>{ROLE_LABELS[role]}</h3>
                <div className="fits-v2-editor-items">
                  {editor.items.filter(item => item.role === role).map(item => (
                    <div key={item.editorItemId} className="fits-v2-editor-item">
                      <img src={`https://images.evetech.net/types/${item.typeId}/icon?size=64`} alt="" />
                      <span>{item.name}</span>
                      {(role === 'extras' || role === 'droneBay' || role === 'fighterBay') && (
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={event => updateQuantity(item.editorItemId, Number(event.target.value))}
                          aria-label={`${item.name} quantity`}
                        />
                      )}
                      <button type="button" onClick={() => removeItem(item.editorItemId)}>Remove</button>
                    </div>
                  ))}
                  {editor.items.filter(item => item.role === role).length === 0 && <p>Empty</p>}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const EDITOR_ROLE_ORDER: FitSectionRole[] = ['high', 'mid', 'low', 'rig', 'subsystem', 'service', 'droneBay', 'fighterBay', 'extras'];
const ROLE_LABELS: Record<FitSectionRole, string> = {
  high: 'High Slots',
  mid: 'Mid Slots',
  low: 'Low Slots',
  rig: 'Rigs',
  subsystem: 'Subsystems',
  service: 'Service Slots',
  droneBay: 'Drone Bay',
  fighterBay: 'Fighter Bay',
  extras: 'Cargo / Extras',
  unmatched: 'Unmatched',
};

function editorDocumentFromSavedFit(fit: SavedFitDetail): FitsV2EditorDocument {
  const lineCharges = new Map<string, AssignedFitItem>();
  for (const item of fit.items) if (item.source === 'loaded-charge') lineCharges.set(`${item.sectionIndex}:${item.lineIndex}`, item);
  return {
    version: 1,
    hull: fit.ship ?? { typeId: 0, name: fit.headerShipName, groupId: 0, groupName: 'Unknown' },
    fitName: fit.fitName,
    notes: fit.notes,
    skillProfile: { kind: 'all-v', characterId: null, name: 'All V' },
    items: fit.items
      .filter(item => item.source === 'fit-line' && item.typeId != null)
      .map(item => {
        const charge = lineCharges.get(`${item.sectionIndex}:${item.lineIndex}`);
        return {
          editorItemId: `${item.role}-${item.lineIndex}-${item.typeId}`,
          typeId: item.typeId!,
          name: item.resolvedName ?? item.inputName,
          role: item.role,
          quantity: item.quantity,
          slotIndex: slotIndexFromFlag(item.slotFlag),
          state: 'offline',
          chargeTypeId: charge?.typeId ?? null,
          chargeName: charge?.resolvedName ?? charge?.inputName ?? null,
        };
      }),
  };
}

function renderEditorToEft(editor: FitsV2EditorDocument): string {
  const lines = [`[${editor.hull.name}, ${editor.fitName}]`];
  for (const role of EDITOR_ROLE_ORDER) {
    const items = editor.items.filter(item => item.role === role);
    if (items.length === 0) continue;
    lines.push('');
    for (const item of items) {
      const base = item.chargeName ? `${item.name}, ${item.chargeName}` : item.name;
      lines.push(item.quantity === 1 ? base : `${base} x${item.quantity}`);
    }
  }
  return lines.join('\n');
}

function firstAvailableSlotRole(editor: FitsV2EditorDocument): FitSectionRole {
  const high = editor.items.filter(item => item.role === 'high').length;
  const mid = editor.items.filter(item => item.role === 'mid').length;
  const low = editor.items.filter(item => item.role === 'low').length;
  if (high < 8) return 'high';
  if (mid < 8) return 'mid';
  if (low < 8) return 'low';
  return 'extras';
}

function slotIndexFor(items: FitsV2EditorItem[], role: FitSectionRole): number | null {
  if (role === 'extras' || role === 'droneBay' || role === 'fighterBay' || role === 'unmatched') return null;
  return items.filter(item => item.role === role).length;
}

function slotIndexFromFlag(flag: string | null): number | null {
  if (!flag) return null;
  const match = /\d+$/.exec(flag);
  return match ? Number(match[0]) : null;
}

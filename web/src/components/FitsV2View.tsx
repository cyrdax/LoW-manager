import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { fetchFit, fetchFits, quoteDraftFit, saveFit, searchFitItems, searchFitShips, sendDraftFit, type AssignedFitItem, type CharacterStatus, type CurrentUser, type FitHub, type FitItemHit, type FitQuote, type FitSectionRole, type FitShipHit, type FitsV2EditorDocument, type FitsV2EditorItem, type LibraryVisibility, type SavedFitDetail, type SavedFitSummary, updateFit } from '../api.ts';

const FITS_V2_HUB_KEY = 'fits-v2-hub';
const FITS_V2_PILOT_KEY = 'fits-v2-pilot';

function formatIsk(n: number | null | undefined): string {
  if (n == null) return '-';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

interface Props {
  chars: CharacterStatus[];
  currentUser?: CurrentUser | null;
  visibility: LibraryVisibility;
  routeFitId: number | null;
  onOpenFitRoute: (id: number) => void;
}

type SendStatus =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; fittingId: number | null; excludedCount: number }
  | { kind: 'error'; message: string; reauthHint?: string | null };

type LeftTab = 'hulls' | 'hardware';

export function FitsV2View({ chars, currentUser, visibility, routeFitId, onOpenFitRoute }: Props) {
  const fitNameInputRef = useRef<HTMLInputElement | null>(null);
  const [fits, setFits] = useState<SavedFitSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(routeFitId);
  const [detail, setDetail] = useState<SavedFitDetail | null>(null);
  const [editor, setEditor] = useState<FitsV2EditorDocument | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>('hulls');
  const [fitName, setFitName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hub, setHub] = useState<FitHub>(() => localStorage.getItem(FITS_V2_HUB_KEY) === 'amarr' ? 'amarr' : 'jita');
  const [quote, setQuote] = useState<FitQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<SendStatus>({ kind: 'idle' });
  const [pilotId, setPilotId] = useState<number | null>(() => {
    const raw = localStorage.getItem(FITS_V2_PILOT_KEY);
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  const [hullQuery, setHullQuery] = useState('');
  const [hullHits, setHullHits] = useState<FitShipHit[]>([]);
  const [itemQuery, setItemQuery] = useState('');
  const [itemHits, setItemHits] = useState<FitItemHit[]>([]);
  const [hardwareRole, setHardwareRole] = useState<FitSectionRole | null>(null);

  const sortedChars = useMemo(() => [...chars].sort((a, b) => a.name.localeCompare(b.name)), [chars]);

  useEffect(() => { setSelectedId(routeFitId); }, [routeFitId]);
  useEffect(() => { localStorage.setItem(FITS_V2_HUB_KEY, hub); }, [hub]);
  useEffect(() => {
    if (pilotId != null) localStorage.setItem(FITS_V2_PILOT_KEY, String(pilotId));
  }, [pilotId]);
  useEffect(() => {
    if (sortedChars.length === 0) return;
    if (pilotId == null || !sortedChars.some(char => char.characterId === pilotId)) {
      setPilotId(sortedChars[0].characterId);
    }
  }, [sortedChars, pilotId]);

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
        setQuote(null);
        setQuoteError(null);
        setSendStatus({ kind: 'idle' });
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
    setLeftTab('hardware');
  }

  function startHull(hit: FitShipHit) {
    const nextEditor: FitsV2EditorDocument = {
      version: 1,
      hull: { typeId: hit.id, name: hit.name, groupId: hit.groupId, groupName: hit.groupName },
      fitName: `${hit.name} fit`,
      notes: '',
      skillProfile: { kind: 'all-v', characterId: null, name: 'All V' },
      items: [],
    };
    setSelectedId(null);
    setDetail(null);
    setEditor(nextEditor);
    setFitName(nextEditor.fitName);
    setQuote(null);
    setQuoteError(null);
    setSendStatus({ kind: 'idle' });
    setStatus(null);
    setSaveStatus(null);
    setLeftTab('hardware');
    setItemQuery('');
    setItemHits([]);
  }

  function addItem(hit: FitItemHit) {
    if (!editor) {
      setSaveStatus('Choose a hull before adding items.');
      return;
    }
    const role = hardwareRole ?? hit.role ?? firstAvailableSlotRole(editor);
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
    setQuote(null);
    setQuoteError(null);
    setSendStatus({ kind: 'idle' });
    setSaveStatus(null);
  }

  function focusFitName() {
    fitNameInputRef.current?.focus();
    fitNameInputRef.current?.select();
  }

  function removeItem(editorItemId: string) {
    if (!editor) return;
    setEditor({ ...editor, items: editor.items.filter(item => item.editorItemId !== editorItemId) });
    setQuote(null);
    setQuoteError(null);
    setSendStatus({ kind: 'idle' });
  }

  function updateQuantity(editorItemId: string, quantity: number) {
    if (!editor) return;
    setEditor({
      ...editor,
      items: editor.items.map(item => item.editorItemId === editorItemId ? { ...item, quantity: Math.max(1, Math.floor(quantity) || 1) } : item),
    });
    setQuote(null);
    setQuoteError(null);
    setSendStatus({ kind: 'idle' });
  }

  function updateSkillProfile(value: string) {
    if (!editor) return;
    if (value === 'all-v') {
      setEditor({
        ...editor,
        skillProfile: { kind: 'all-v', characterId: null, name: 'All V' },
      });
    } else {
      const characterId = Number(value.replace('pilot:', ''));
      const pilot = sortedChars.find(char => char.characterId === characterId);
      if (!pilot) return;
      setEditor({
        ...editor,
        skillProfile: { kind: 'pilot', characterId: pilot.characterId, name: pilot.name },
      });
    }
    setQuote(null);
    setQuoteError(null);
    setSendStatus({ kind: 'idle' });
  }

  async function refreshQuote() {
    if (!editor) {
      setQuoteError('Choose a hull before pricing.');
      return;
    }
    const namedEditor = { ...editor, fitName: fitName.trim() || editor.fitName };
    const rawEft = renderEditorToEft(namedEditor);
    setQuoteLoading(true);
    setQuoteError(null);
    const result = await quoteDraftFit(rawEft, hub, editor.hull.typeId);
    setQuoteLoading(false);
    if ('error' in result) {
      setQuote(null);
      setQuoteError(result.error);
      return;
    }
    setQuote(result);
  }

  async function copyEft() {
    if (!editor) return;
    const namedEditor = { ...editor, fitName: fitName.trim() || editor.fitName };
    await navigator.clipboard.writeText(renderEditorToEft(namedEditor));
    setSaveStatus('Copied EFT.');
  }

  async function sendToPilot() {
    if (!editor || pilotId == null) return;
    const namedEditor = { ...editor, fitName: fitName.trim() || editor.fitName };
    setSendStatus({ kind: 'sending' });
    const result = await sendDraftFit(renderEditorToEft(namedEditor), pilotId, {
      shipTypeId: editor.hull.typeId,
      fitName: namedEditor.fitName,
      notes: namedEditor.notes,
    });
    if ('error' in result) {
      setSendStatus({ kind: 'error', message: result.error, reauthHint: result.reauthHint });
      return;
    }
    setSendStatus({ kind: 'sent', fittingId: result.fittingId, excludedCount: result.excludedCount });
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

  const activeShipTypeId = editor?.hull.typeId ?? activeFit?.shipTypeId ?? detail?.ship?.typeId ?? null;
  const activeShipName = editor?.hull.name ?? detail?.ship?.name ?? activeFit?.shipName ?? 'No hull selected';
  const fitTitle = fitName.trim() || editor?.fitName || detail?.fitName || 'Unsaved fit';
  const shipRender = activeShipTypeId != null ? `https://images.evetech.net/types/${activeShipTypeId}/render?size=512` : null;
  const roleItems = (role: FitSectionRole) => editor?.items.filter(item => item.role === role) ?? [];
  const fittedItemCount = editor?.items.filter(item => ['high', 'mid', 'low', 'rig', 'subsystem', 'service'].includes(item.role)).length ?? 0;
  const cargoItemCount = editor?.items.filter(item => ['droneBay', 'fighterBay', 'extras'].includes(item.role)).reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const fitGroups = Array.from(new Set(fits.map(fit => fit.shipName))).sort((a, b) => a.localeCompare(b));
  const statPrice = quote ? `${formatIsk(quote.totals.grand)} ISK` : quoteLoading ? 'Pricing...' : '-';

  return (
    <section className="fits-v2-view eveship-shell">
      <header className="eveship-titlebar">EVEShip.fit - View, Create, and Share your EVE Online ship fits online</header>

      <aside className="eveship-left">
        <div className="eveship-tabs" role="tablist" aria-label="Fits v2 library">
          <button type="button" className={leftTab === 'hulls' ? 'active' : ''} onClick={() => setLeftTab('hulls')}>Hull &amp; Fits</button>
          <button type="button" className={leftTab === 'hardware' ? 'active' : ''} onClick={() => setLeftTab('hardware')}>Hardware</button>
        </div>
        {leftTab === 'hulls' ? (
          <>
            <input
              className="eveship-search"
              value={hullQuery}
              onChange={event => setHullQuery(event.target.value)}
              placeholder="Search hulls to start"
            />
            <div className="eveship-tree">
              {hullHits.length > 0 ? hullHits.slice(0, 12).map(hit => (
                <button key={hit.id} type="button" className="eveship-tree-row" onClick={() => startHull(hit)}>
                  <span className="twisty">▸</span>
                  <span>{hit.name}</span>
                  <small>{hit.groupName}</small>
                </button>
              )) : fitGroups.length > 0 ? fitGroups.map(group => (
                <details key={group} open={group === activeShipName}>
                  <summary>{group}</summary>
                  {fits.filter(fit => fit.shipName === group).map(fit => (
                    <button key={fit.id} className={fit.id === selectedId ? 'active' : ''} type="button" onClick={() => openFit(fit.id)}>
                      <img src={`https://images.evetech.net/types/${fit.shipTypeId}/icon?size=32`} alt="" />
                      <span>{fit.fitName}</span>
                      {fit.hasEditorJson && <em>v2</em>}
                    </button>
                  ))}
                </details>
              )) : (
                <div className="empty">Search for a hull to begin.</div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="eveship-icon-row" aria-label="Hardware slot target">
              {HARDWARE_BUTTONS.map(button => (
                <button
                  key={button.label}
                  type="button"
                  className={`eveship-hardware-button${hardwareRole === button.role ? ' active' : ''}`}
                  title={button.title}
                  onClick={() => setHardwareRole(button.role)}
                >
                  <span aria-hidden="true">{button.symbol}</span>
                  <small>{button.label}</small>
                </button>
              ))}
            </div>
            <input
              className="eveship-search hardware-search"
              value={itemQuery}
              onChange={event => setItemQuery(event.target.value)}
              placeholder="Search modules, drones, cargo"
            />
          <div className="eveship-hardware-results">
              {!editor ? (
                <div className="empty">Choose a hull before adding hardware.</div>
              ) : itemQuery.trim().length < 2 ? (
                <div className="empty">Search for modules, drones, cargo, or charges.</div>
              ) : itemHits.length > 0 ? itemHits.slice(0, 16).map(hit => (
                <button key={hit.id} type="button" aria-label={`Add ${hit.name} to fit`} onClick={() => addItem(hit)}>
                  <span>{hit.name}</span>
                  <small>{hit.categoryName} / {hit.groupName}{hit.role ? ` / ${ROLE_LABELS[hit.role]}` : ''}</small>
                </button>
              )) : (
                <div className="empty">No matching hardware found.</div>
              )}
          </div>
          </>
        )}

        <div className="eveship-actions">
          <button type="button" onClick={saveEditor} disabled={!editor || saving}>{saving ? 'Saving...' : detail ? 'Save changes' : 'Save'}</button>
          <button type="button" onClick={copyEft} disabled={!editor}>Copy EFT</button>
          <button type="button" onClick={refreshQuote} disabled={!editor || quoteLoading}>{quoteLoading ? 'Pricing...' : 'Refresh price'}</button>
          <button type="button" onClick={focusFitName} disabled={!editor}>Rename</button>
        </div>
      </aside>

      <main className="eveship-center">
        <div className="eveship-fit-name">
          <label>Name</label>
          {editor
            ? <input ref={fitNameInputRef} value={fitName} onChange={event => setFitName(event.target.value)} aria-label="Fit name" />
            : <strong>{fitTitle}</strong>}
        </div>

        <div className="fitting-ring" aria-label="Fitting slots">
          {shipRender && <img className="fitting-ship" src={shipRender} alt="" />}
          {!editor && <p>To start, select a hull on the left.</p>}
          {editor && RING_ROLE_ORDER.map((role, roleIndex) => roleItems(role).slice(0, 8).map((item, index, arr) => {
            const angle = ringAngle(roleIndex, index, arr.length);
            return (
              <button
                key={item.editorItemId}
                type="button"
                className={`ring-slot ring-slot-${role}`}
                style={{ '--slot-angle': `${angle}deg` } as CSSProperties}
                title={item.name}
                onClick={() => removeItem(item.editorItemId)}
              >
                <img src={`https://images.evetech.net/types/${item.typeId}/icon?size=64`} alt="" />
              </button>
            );
          }))}
          <div className="ring-markers" aria-hidden="true" />
        </div>

        <div className="eveship-center-bottom">
          <div className="eveship-capacity">
            <span>▰ {fittedItemCount.toFixed(1)}</span>
            <span>/ 0.0 m3</span>
            <span>◇ {cargoItemCount.toFixed(1)}</span>
            <span>/ 0.0 m3</span>
          </div>
          <div className="eveship-history">
            <h3>Simulation History</h3>
            <ul>
              <li><span>Dogma engine</span><strong>{editor ? 'Ready' : 'Waiting for hull'}</strong></li>
              <li><span>Skill profile</span><strong>{editor?.skillProfile.name ?? 'All V'}</strong></li>
              <li><span>Market quote</span><strong>{statPrice}</strong></li>
            </ul>
          </div>
        </div>
      </main>

      <aside className="eveship-right">
        <select
          className="eveship-character"
          value={editor?.skillProfile.kind === 'all-v' ? 'all-v' : `pilot:${editor?.skillProfile.characterId}`}
          onChange={event => updateSkillProfile(event.target.value)}
          disabled={!editor}
        >
          <option value="all-v">Default character - All Skills L5</option>
          {sortedChars.map(char => <option key={char.characterId} value={`pilot:${char.characterId}`}>{char.name}</option>)}
        </select>

        <StatPanel title="Capacitor" rows={[['0.0 GJ / 0.00 s', ''], ['Δ 0.0 GJ/s (0.0%)', '']]} />
        <StatPanel title="Offense" rows={[[`${fittedItemCount.toFixed(1)} dps`, ''], ['0 HP', '']]} />
        <StatPanel title="Defense" rows={[['No Module', ''], ['0 hp', '100 %'], ['0 hp', '100 %'], ['0 hp', '100 %']]} />
        <StatPanel title="Targeting" rows={[['0.00 points', ''], ['0 m', '']]} />
        <StatPanel title="Navigation" rows={[['0.00 t', ''], ['0.00 AU/s', '']]} />
        <StatPanel title="Drones" rows={[[`${roleItems('droneBay').length}/${roleItems('fighterBay').length} Mbit/sec`, ''], ['0 Active', '']]} />
        <StatPanel title="Price" rows={[[statPrice, quote?.systemName ?? hub.toUpperCase()], [`${quote?.counts.ok ?? 0} priced`, `${quote?.counts.noOrders ?? 0} no sellers`]]} />

        <div className="eveship-send">
          {currentUser ? (
            <>
              <select value={pilotId ?? ''} onChange={event => setPilotId(Number(event.target.value) || null)}>
                {sortedChars.length === 0 && <option value="">No pilots</option>}
                {sortedChars.map(char => (
                  <option key={char.characterId} value={char.characterId}>
                    {char.name}{char.needsReauth ? ' (needs re-auth)' : ''}
                  </option>
                ))}
              </select>
              <button type="button" onClick={sendToPilot} disabled={!editor || pilotId == null || sendStatus.kind === 'sending'}>
                {sendStatus.kind === 'sending' ? 'Sending...' : 'Send Fit'}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => window.open('/auth/login', '_blank', 'width=560,height=720')}>Log in to send to a pilot</button>
          )}
        </div>

        {status && <div className="eveship-status warn">{status}</div>}
        {saveStatus && <div className="eveship-status">{saveStatus}</div>}
        {quoteError && <div className="eveship-status err">{quoteError}</div>}
        {sendStatus.kind === 'sent' && <div className="eveship-status ok">Fitting #{sendStatus.fittingId ?? 'created'} - {sendStatus.excludedCount} excluded</div>}
        {sendStatus.kind === 'error' && <div className="eveship-status err">{sendStatus.message}{sendStatus.reauthHint ? ` - ${sendStatus.reauthHint}` : ''}</div>}

        {editor && (
          <div className="eveship-slot-list">
            {EDITOR_ROLE_ORDER.map(role => (
              <section key={role}>
                <h3>{ROLE_LABELS[role]}</h3>
                {roleItems(role).map(item => (
                  <div key={item.editorItemId} className="eveship-slot-row">
                    <img src={`https://images.evetech.net/types/${item.typeId}/icon?size=32`} alt="" />
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
                    <button type="button" onClick={() => removeItem(item.editorItemId)}>×</button>
                  </div>
                ))}
                {roleItems(role).length === 0 && <p>No Module</p>}
              </section>
            ))}
          </div>
        )}
      </aside>
    </section>
  );
}

const EDITOR_ROLE_ORDER: FitSectionRole[] = ['high', 'mid', 'low', 'rig', 'subsystem', 'service', 'droneBay', 'fighterBay', 'extras'];
const RING_ROLE_ORDER: FitSectionRole[] = ['high', 'mid', 'low', 'rig', 'subsystem'];
const HARDWARE_BUTTONS: { label: string; symbol: string; role: FitSectionRole | null; title: string }[] = [
  { label: 'All', symbol: '◆', role: null, title: 'Add items to their detected slot' },
  { label: 'High', symbol: '▰', role: 'high', title: 'Add search results as high-slot modules' },
  { label: 'Mid', symbol: '●', role: 'mid', title: 'Add search results as mid-slot modules' },
  { label: 'Low', symbol: '✪', role: 'low', title: 'Add search results as low-slot modules' },
  { label: 'Rig', symbol: '✣', role: 'rig', title: 'Add search results as rigs' },
  { label: 'Cargo', symbol: '♜', role: 'extras', title: 'Add search results to cargo and extras' },
];
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

function ringAngle(roleIndex: number, itemIndex: number, itemCount: number): number {
  const arcs = [
    { start: 218, end: 318 },
    { start: 322, end: 52 },
    { start: 56, end: 138 },
    { start: 142, end: 214 },
    { start: 20, end: 160 },
  ];
  const arc = arcs[roleIndex % arcs.length];
  const span = arc.end >= arc.start ? arc.end - arc.start : (360 - arc.start) + arc.end;
  const step = itemCount <= 1 ? span / 2 : span / Math.max(1, itemCount - 1);
  return (arc.start + step * itemIndex) % 360;
}

function StatPanel({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section className="eveship-stat-panel">
      <h3>{title}</h3>
      {rows.map(([label, value], index) => (
        <div key={`${title}-${index}`}>
          <span>{label}</span>
          {value && <strong>{value}</strong>}
        </div>
      ))}
    </section>
  );
}

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

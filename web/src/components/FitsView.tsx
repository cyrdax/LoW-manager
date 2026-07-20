import { useEffect, useMemo, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react';
import {
  copyFitToPrivate,
  deleteFit,
  fetchFit,
  fetchDoctrines,
  fetchFits,
  importPyfaImage,
  previewFit,
  publishFit,
  quoteDraftFit,
  quoteSavedFit,
  saveFit,
  sendDraftFit,
  sendSavedFit,
  updateFit,
  type AssignedFitItem,
  type CharacterStatus,
  type CurrentUser,
  type DoctrineSummary,
  type FitDraft,
  type FitHub,
  type FitQuote,
  type FitSectionRole,
  type LibraryVisibility,
  type PyfaImageImportRequest,
  type SavedFitDetail,
  type SavedFitSummary,
} from '../api.ts';
import { DoctrinesView } from './DoctrinesView.tsx';
import { FitModeSwitch, type FitMode } from './FitModeSwitch.tsx';
import { LibraryScopeSwitch } from './LibraryScopeSwitch.tsx';
import type { AppRoute } from '../app-routes.ts';

interface Props {
  chars: CharacterStatus[];
  currentUser: CurrentUser;
  route: AppRoute;
  routeFitId: number | null;
  routeDoctrineId: number | null;
  onOpenFitRoute: (id: number) => void;
  onOpenDoctrineRoute: (id: number) => void;
  onModeRoute: (mode: FitMode) => void;
}

const FITS_HUB_KEY = 'efd.fits.hub';
const FITS_MODE_KEY = 'efd.fits.mode';
const FITS_PILOT_KEY = 'efd.fits.pilot';
const FITS_VISIBILITY_KEY = 'efd.fits.visibility';

const SLOT_ROLES: FitSectionRole[] = ['high', 'mid', 'low', 'rig', 'subsystem', 'service'];
const EXTRA_ROLES: FitSectionRole[] = ['droneBay', 'fighterBay', 'extras', 'unmatched'];
const SAMPLE = `[Naglfar, Simulated Naglfar Fitting]
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Tracking Enhancer II
Tracking Enhancer II
Capacitor Power Relay II

Capital Clarity Ward Enduring Shield Booster
Pithum C-Type Multispectrum Shield Hardener

Quad 800mm Repeating Cannon II
Siege Module II

Capital Semiconductor Memory Cell I

Hail XL x4057`;

type SendStatus =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; fittingId: number | null; excludedCount: number }
  | { kind: 'error'; message: string; reauthHint?: string | null };

type FitTooltipState = { label: string; x: number; y: number } | null;
type FitTooltipHandlers = {
  show: (label: string, target: HTMLElement) => void;
  hide: () => void;
};

function formatIsk(n: number | null | undefined): string {
  if (n == null) return '-';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function iconUrl(typeId: number): string {
  return `https://images.evetech.net/types/${typeId}/icon?size=64`;
}

export function FitsView({ chars, currentUser, route, routeFitId, routeDoctrineId, onOpenFitRoute, onOpenDoctrineRoute, onModeRoute }: Props) {
  const routeMode = route.view === 'fits' ? route.mode : undefined;
  const [mode, setMode] = useState<FitMode>(() => routeMode ?? ((localStorage.getItem(FITS_MODE_KEY) as FitMode) || 'fits'));
  const [visibility, setVisibility] = useState<LibraryVisibility>(() => (localStorage.getItem(FITS_VISIBILITY_KEY) as LibraryVisibility) || 'private');
  useEffect(() => { localStorage.setItem(FITS_MODE_KEY, mode); }, [mode]);
  useEffect(() => { localStorage.setItem(FITS_VISIBILITY_KEY, visibility); }, [visibility]);
  useEffect(() => {
    if (routeFitId != null) setMode('fits');
    else if (routeDoctrineId != null) setMode('doctrines');
    else if (routeMode != null) setMode(routeMode);
  }, [routeFitId, routeDoctrineId, routeMode]);

  function chooseMode(nextMode: FitMode) {
    setMode(nextMode);
    onModeRoute(nextMode);
  }

  function openDoctrineFit(fit: SavedFitSummary) {
    setVisibility(fit.visibility);
    setMode('fits');
    onOpenFitRoute(fit.id);
  }

  function openFitDoctrine(doctrine: DoctrineSummary) {
    setVisibility(doctrine.visibility);
    setMode('doctrines');
    onOpenDoctrineRoute(doctrine.id);
  }

  return (
    <main className="rows-wrap fits-page">
      <div className="fits-topbar">
        <FitModeSwitch mode={mode} onMode={chooseMode} />
        <LibraryScopeSwitch value={visibility} onChange={setVisibility} />
      </div>
      {mode === 'doctrines'
        ? <DoctrinesView currentUser={currentUser} visibility={visibility} setVisibility={setVisibility} onOpenFit={openDoctrineFit} routeDoctrineId={routeDoctrineId} onOpenDoctrineRoute={onOpenDoctrineRoute} onModeRoute={onModeRoute} />
        : <SavedFitsView chars={chars} currentUser={currentUser} visibility={visibility} setVisibility={setVisibility} routeFitId={routeFitId} onOpenFitRoute={onOpenFitRoute} onModeRoute={onModeRoute} onOpenDoctrine={openFitDoctrine} />}
    </main>
  );
}

function SavedFitsView({
  chars,
  currentUser,
  visibility,
  setVisibility,
  routeFitId,
  onOpenFitRoute,
  onModeRoute,
  onOpenDoctrine,
}: Pick<Props, 'chars' | 'currentUser'> & { visibility: LibraryVisibility; setVisibility: (visibility: LibraryVisibility) => void; routeFitId: number | null; onOpenFitRoute: (id: number) => void; onModeRoute: (mode: FitMode) => void; onOpenDoctrine: (doctrine: DoctrineSummary) => void }) {
  const [fits, setFits] = useState<SavedFitSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SavedFitDetail | null>(null);
  const [draft, setDraft] = useState<FitDraft | null>(null);
  const [search, setSearch] = useState('');
  const [hub, setHub] = useState<FitHub>(() => (localStorage.getItem(FITS_HUB_KEY) as FitHub) || 'jita');
  const [quote, setQuote] = useState<FitQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState(SAMPLE);
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMode, setImportMode] = useState<'eft' | 'pyfa-image'>('eft');
  const [pyfaImage, setPyfaImage] = useState<File | null>(null);
  const [pyfaBusy, setPyfaBusy] = useState(false);
  const [pyfaWarnings, setPyfaWarnings] = useState<string[]>([]);
  const [pyfaNotice, setPyfaNotice] = useState<string | null>(null);
  const [pyfaDragging, setPyfaDragging] = useState(false);
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);
  const [fitName, setFitName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<SendStatus>({ kind: 'idle' });
  const [tooltip, setTooltip] = useState<FitTooltipState>(null);
  const [fitDoctrines, setFitDoctrines] = useState<DoctrineSummary[]>([]);
  const [fitDoctrinesLoading, setFitDoctrinesLoading] = useState(false);

  const sortedChars = useMemo(() => [...chars].sort((a, b) => a.name.localeCompare(b.name)), [chars]);
  const [pilotId, setPilotId] = useState<number | null>(() => {
    const raw = localStorage.getItem(FITS_PILOT_KEY);
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  });

  useEffect(() => { localStorage.setItem(FITS_HUB_KEY, hub); }, [hub]);
  useEffect(() => {
    if (pilotId != null) localStorage.setItem(FITS_PILOT_KEY, String(pilotId));
  }, [pilotId]);
  useEffect(() => {
    if (sortedChars.length === 0) return;
    if (pilotId == null || !sortedChars.some(c => c.characterId === pilotId)) {
      setPilotId(sortedChars[0].characterId);
    }
  }, [sortedChars, pilotId]);

  const reloadList = async (scope = visibility) => {
    const rows = await fetchFits(scope);
    setFits(rows);
    setSelectedId(current => {
      if (routeFitId != null) return routeFitId;
      return (current != null && rows.some(row => row.id === current)) ? current : rows[0]?.id ?? null;
    });
  };
  useEffect(() => {
    setDraft(null);
    setDetail(null);
    setSelectedId(routeFitId);
    reloadList(visibility);
  }, [visibility]);

  useEffect(() => {
    if (routeFitId == null) return;
    setDraft(null);
    setDetail(null);
    setSearch('');
    setSelectedId(routeFitId);
  }, [routeFitId]);

  useEffect(() => {
    if (selectedId == null || draft) { setDetail(null); return; }
    let cancelled = false;
    fetchFit(selectedId).then(res => {
      if (cancelled) return;
      if ('error' in res) setDetail(null);
      else {
        setDetail(res);
        if (routeFitId === res.id && res.visibility !== visibility) setVisibility(res.visibility);
      }
    });
    return () => { cancelled = true; };
  }, [selectedId, draft, routeFitId, visibility]);

  const active = draft ?? detail;
  const activeSavedId = draft ? null : detail?.id ?? null;
  const activeVisibility = draft ? visibility : detail?.visibility ?? visibility;
  const canEditActive = !detail || currentUser.role === 'admin' || detail.ownerUserId === currentUser.id;
  const canPublishActive = activeSavedId != null && canEditActive && detail?.visibility === 'private';
  const canCopyPrivate = activeSavedId != null && detail?.visibility === 'public';
  const unmatchedItems = active?.items.filter(item => item.role === 'unmatched') ?? [];
  const tooltipHandlers: FitTooltipHandlers = {
    show: (label, target) => {
      const rect = target.getBoundingClientRect();
      const edge = Math.min(140, Math.max(16, window.innerWidth / 2));
      const x = Math.min(window.innerWidth - edge, Math.max(edge, rect.left + rect.width / 2));
      setTooltip({ label, x, y: Math.max(12, rect.top - 7) });
    },
    hide: () => setTooltip(null),
  };

  useEffect(() => {
    setFitName(active?.fitName ?? '');
    setNotes('notes' in (active ?? {}) ? (active as SavedFitDetail).notes : '');
    setStatus(null);
    setSendStatus({ kind: 'idle' });
  }, [active?.fitName, active?.rawEft]);

  useEffect(() => {
    if (!active) { setQuote(null); return; }
    refreshQuote(active);
  }, [active?.rawEft, activeSavedId, hub]);

  useEffect(() => {
    if (!activeSavedId) {
      setFitDoctrines([]);
      setFitDoctrinesLoading(false);
      return;
    }
    let cancelled = false;
    setFitDoctrinesLoading(true);
    fetchDoctrines('', activeVisibility, activeSavedId)
      .then(rows => { if (!cancelled) setFitDoctrines(rows); })
      .catch(() => { if (!cancelled) setFitDoctrines([]); })
      .finally(() => { if (!cancelled) setFitDoctrinesLoading(false); });
    return () => { cancelled = true; };
  }, [activeSavedId, activeVisibility]);

  const filteredFits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return fits;
    return fits.filter(fit => `${fit.shipName} ${fit.fitName}`.toLowerCase().includes(q));
  }, [fits, search]);

  const selectPyfaImage = (file: File | null) => {
    setPyfaImage(file);
    setPyfaWarnings([]);
    setPyfaNotice(null);
    setImportError(null);
  };

  const handlePyfaFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    selectPyfaImage(event.target.files?.[0] ?? null);
  };

  const handlePyfaDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setPyfaDragging(false);
    selectPyfaImage(event.dataTransfer.files?.[0] ?? null);
  };

  const handlePyfaPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const file = imageFileFromList(event.clipboardData.files);
    if (!file) {
      setImportError('Clipboard does not contain an image.');
      return;
    }
    event.preventDefault();
    selectPyfaImage(file);
  };

  const pastePyfaImageFromClipboard = async () => {
    if (!navigator.clipboard?.read) {
      setImportError('Clipboard image paste is not supported in this browser. Use Ctrl+V or choose an image.');
      return;
    }
    setImportError(null);
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const mimeType = item.types.find(isPyfaImageMimeType);
        if (!mimeType) continue;
        const blob = await item.getType(mimeType);
        selectPyfaImage(new File([blob], `clipboard.${imageExtension(mimeType)}`, { type: mimeType }));
        return;
      }
      setImportError('Clipboard does not contain an image.');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to read clipboard image.');
    }
  };

  const extractPyfaImage = async () => {
    if (pyfaBusy || !pyfaImage) return;
    if (!isPyfaImageMimeType(pyfaImage.type)) {
      setImportError('Unsupported image type. Use PNG, JPEG, or WebP.');
      return;
    }

    setImportError(null);
    setPyfaWarnings([]);
    setPyfaBusy(true);
    try {
      const imageBase64 = await readFileBase64(pyfaImage);
      const res = await importPyfaImage({ imageBase64, mimeType: pyfaImage.type });
      if ('error' in res) { setImportError(res.error); return; }
      setImportText(res.rawEft);
      setPyfaWarnings(res.warnings);
      setPyfaNotice('Generated from screenshot. Review before preview.');
      setImportMode('eft');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to extract pyfa screenshot.');
    } finally {
      setPyfaBusy(false);
    }
  };

  const importFit = async () => {
    if (importBusy) return;
    setImportError(null);
    setImportBusy(true);
    try {
      const res = await previewFit(importText);
      if ('error' in res) { setImportError(res.error); return; }
      setDraft(res);
      setSelectedId(null);
      setImportOpen(false);
      if (res.warnings.some(w => w.code === 'unmatched-item')) setUnmatchedOpen(true);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to preview fit.');
    } finally {
      setImportBusy(false);
    }
  };

  async function refreshQuote(fit: FitDraft | SavedFitDetail = active!) {
    if (!fit) return;
    setQuoteLoading(true);
    setQuoteError(null);
    const res = draft || !('id' in fit)
      ? await quoteDraftFit(fit.rawEft, hub, fit.ship?.typeId)
      : await quoteSavedFit(fit.id, hub);
    setQuoteLoading(false);
    if ('error' in res) { setQuote(null); setQuoteError(res.error); }
    else setQuote(res);
  }

  const saveCurrent = async () => {
    if (!active) return;
    setBusy(true);
    setStatus(null);
    const res = draft
      ? await saveFit({ rawEft: draft.rawEft, shipTypeId: draft.ship?.typeId, fitName, notes, visibility })
      : activeSavedId != null
        ? await updateFit(activeSavedId, { fitName, notes })
        : { error: 'No fit selected.' };
    setBusy(false);
    if ('error' in res) { setStatus(res.error); return; }
    setDraft(null);
    setDetail(res);
    setSelectedId(res.id);
    onOpenFitRoute(res.id);
    setStatus('Saved.');
    await reloadList(res.visibility);
  };

  const publishCurrent = async () => {
    if (activeSavedId == null) return;
    setBusy(true);
    setStatus(null);
    const res = await publishFit(activeSavedId);
    setBusy(false);
    if ('error' in res) { setStatus(res.error); return; }
    setVisibility('public');
    setDraft(null);
    setDetail(res);
    setSelectedId(res.id);
    onOpenFitRoute(res.id);
    setStatus('Published.');
    await reloadList('public');
  };

  const copyCurrentToPrivate = async () => {
    if (activeSavedId == null) return;
    setBusy(true);
    setStatus(null);
    const res = await copyFitToPrivate(activeSavedId);
    setBusy(false);
    if ('error' in res) { setStatus(res.error); return; }
    setVisibility('private');
    setDraft(null);
    setDetail(res);
    setSelectedId(res.id);
    onOpenFitRoute(res.id);
    setStatus('Copied to private library.');
    await reloadList('private');
  };

  const deleteCurrent = async () => {
    if (activeSavedId == null) return;
    if (!confirm('Delete this saved fit?')) return;
    const res = await deleteFit(activeSavedId);
    if ('error' in res) { setStatus(res.error); return; }
    setDetail(null);
    setSelectedId(null);
    onModeRoute('fits');
    await reloadList();
  };

  const copyEft = async () => {
    if (!active) return;
    const text = active.normalizedEft.replace(/^\[[^\]]+\]/, `[${active.ship?.name ?? active.headerShipName}, ${fitName || active.fitName}]`);
    await navigator.clipboard.writeText(text);
    setStatus('Copied EFT.');
  };

  const sendToPilot = async () => {
    if (!active || pilotId == null) return;
    setSendStatus({ kind: 'sending' });
    const res = draft
      ? await sendDraftFit(active.rawEft, pilotId, { shipTypeId: active.ship?.typeId, fitName, notes })
      : activeSavedId != null
        ? await sendSavedFit(activeSavedId, pilotId)
        : { error: 'No fit selected.' };
    if ('error' in res) setSendStatus({ kind: 'error', message: res.error, reauthHint: res.reauthHint });
    else setSendStatus({ kind: 'sent', fittingId: res.fittingId, excludedCount: res.excludedCount });
  };

  return (
    <div className="fits-view">
      <aside className="fits-library">
        <div className="fits-lib-head">
          <strong>Fits</strong>
          <button className="fl-refresh" onClick={() => setImportOpen(true)}>Import</button>
        </div>
        <input
          className="fits-search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search fits or hulls"
        />
        <div className="fits-hubs">
          {(['jita', 'amarr'] as const).map(h => (
            <button key={h} className={hub === h ? 'active' : ''} onClick={() => setHub(h)}>
              {h === 'jita' ? 'Jita' : 'Amarr'}
            </button>
          ))}
        </div>
        <div className="fits-list">
          {draft && (
            <button className="fits-row active draft" onClick={() => setSelectedId(null)}>
              <span className="fits-row-ship">{draft.ship?.name ?? draft.headerShipName}</span>
              <span className="fits-row-name">{draft.fitName}</span>
              <span className="fits-row-meta">Draft</span>
            </button>
          )}
          {filteredFits.map(row => (
            <button
              key={row.id}
              className={`fits-row${selectedId === row.id && !draft ? ' active' : ''}`}
              onClick={() => { setDraft(null); setSelectedId(row.id); onOpenFitRoute(row.id); }}
            >
              <span className="fits-row-ship">{row.shipName}</span>
              <span className="fits-row-name">{row.fitName}</span>
              <span className="fits-row-meta">
                {row.itemCount} items - {row.visibility === 'public' ? 'Public' : 'Private'}
                {(row.warningCounts.unmatched + row.warningCounts.overSlot + row.warningCounts.unassignable) > 0 && (
                  <b> - warnings</b>
                )}
              </span>
            </button>
          ))}
          {!draft && filteredFits.length === 0 && <div className="fits-empty">No saved fits.</div>}
        </div>
      </aside>

      <section className="fits-detail" onScroll={tooltipHandlers.hide}>
        {!active && <div className="fits-empty large">Import a fit or select one from the library.</div>}
        {active && (
          <>
            <FitHeader
              fit={active}
              fitName={fitName}
              notes={notes}
              quote={quote}
              quoteLoading={quoteLoading}
              saved={activeSavedId != null}
              visibility={activeVisibility}
              editable={canEditActive}
              canPublish={canPublishActive}
              canCopyPrivate={canCopyPrivate}
              busy={busy}
              chars={sortedChars}
              pilotId={pilotId}
              sendStatus={sendStatus}
              status={status}
              quoteError={quoteError}
              onName={setFitName}
              onNotes={setNotes}
              onPilot={setPilotId}
              onSave={saveCurrent}
              onDelete={deleteCurrent}
              onPublish={publishCurrent}
              onCopyPrivate={copyCurrentToPrivate}
              onCopy={copyEft}
              onSend={sendToPilot}
              onRefresh={() => refreshQuote(active)}
            />

            <div className="fits-body">
              <div className="fits-slots">
                {SLOT_ROLES.map(role => <SlotSection key={role} role={role} fit={active} tooltip={tooltipHandlers} />)}
                {EXTRA_ROLES.map(role => <ExtraSection key={role} role={role} fit={active} tooltip={tooltipHandlers} />)}
              </div>
              <div className="fits-side-panels">
                <PricePanel quote={quote} loading={quoteLoading} error={quoteError} />
                {activeSavedId != null && <FitDoctrinesPanel doctrines={fitDoctrines} loading={fitDoctrinesLoading} onOpen={onOpenDoctrine} />}
              </div>
            </div>
          </>
        )}
      </section>

      {importOpen && (
        <Modal title="Import Fit" onClose={() => setImportOpen(false)}>
          <div className="fits-import-tabs">
            <button type="button" className={importMode === 'eft' ? 'active' : ''} onClick={() => setImportMode('eft')} disabled={importBusy || pyfaBusy}>Paste EFT</button>
            <button type="button" className={importMode === 'pyfa-image' ? 'active' : ''} onClick={() => setImportMode('pyfa-image')} disabled={importBusy || pyfaBusy}>pyfa Screenshot</button>
          </div>

          {importMode === 'eft' && (
            <>
              {pyfaNotice && <div className="fits-import-note">{pyfaNotice}</div>}
              {pyfaWarnings.length > 0 && (
                <div className="fits-import-warnings">
                  {pyfaWarnings.map(warning => <div key={warning}>{warning}</div>)}
                </div>
              )}
              <textarea
                className="fits-import-text"
                value={importText}
                onChange={e => { setImportText(e.target.value); setPyfaNotice(null); }}
                spellCheck={false}
              />
            </>
          )}

          {importMode === 'pyfa-image' && (
            <div
              className={`fits-import-drop${pyfaDragging ? ' dragging' : ''}`}
              tabIndex={0}
              onDragOver={event => { event.preventDefault(); setPyfaDragging(true); }}
              onDragLeave={() => setPyfaDragging(false)}
              onDrop={handlePyfaDrop}
              onPaste={handlePyfaPaste}
            >
              <strong>{pyfaImage ? pyfaImage.name : 'Drop a pyfa screenshot'}</strong>
              <span>Drop, choose, or press Ctrl+V / Cmd+V. Only visible rows are extracted.</span>
              <button type="button" className="fits-import-file" onClick={pastePyfaImageFromClipboard} disabled={pyfaBusy}>Paste from Clipboard</button>
              <label className="fits-import-file">
                Choose image
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePyfaFileInput} />
              </label>
            </div>
          )}

          {importError && <div className="fits-alert err">{importError}</div>}
          <div className="fits-modal-actions">
            <button type="button" onClick={() => setImportOpen(false)} disabled={importBusy || pyfaBusy}>Cancel</button>
            {importMode === 'pyfa-image' ? (
              <button type="button" className="primary" onClick={extractPyfaImage} disabled={pyfaBusy || !pyfaImage}>
                {pyfaBusy ? 'Extracting...' : 'Extract'}
              </button>
            ) : (
              <button type="button" className="primary" onClick={importFit} disabled={importBusy}>
                {importBusy ? 'Previewing...' : 'Preview'}
              </button>
            )}
          </div>
        </Modal>
      )}

      {unmatchedOpen && active && (
        <Modal title="Unmatched Items" onClose={() => setUnmatchedOpen(false)}>
          <div className="fits-alert warn">
            {unmatchedItems.map(item => <div key={item.id}>{item.inputName}</div>)}
          </div>
          <div className="fits-modal-actions">
            <button className="primary" onClick={() => setUnmatchedOpen(false)}>Continue</button>
          </div>
        </Modal>
      )}
      {tooltip && <FitTooltip tooltip={tooltip} />}
    </div>
  );
}

function FitHeader(props: {
  fit: FitDraft | SavedFitDetail;
  fitName: string;
  notes: string;
  quote: FitQuote | null;
  quoteLoading: boolean;
  saved: boolean;
  visibility: LibraryVisibility;
  editable: boolean;
  canPublish: boolean;
  canCopyPrivate: boolean;
  busy: boolean;
  chars: CharacterStatus[];
  pilotId: number | null;
  sendStatus: SendStatus;
  status: string | null;
  quoteError: string | null;
  onName: (v: string) => void;
  onNotes: (v: string) => void;
  onPilot: (v: number | null) => void;
  onSave: () => void;
  onDelete: () => void;
  onPublish: () => void;
  onCopyPrivate: () => void;
  onCopy: () => void;
  onSend: () => void;
  onRefresh: () => void;
}) {
  const { fit } = props;
  const fitCost = props.quote ? `${formatIsk(props.quote.totals.grand)} ISK` : props.quoteLoading ? 'Pricing...' : '-';
  return (
    <div className="fits-fit-head">
      <div className="fits-head-main">
        <div className="fits-ship-summary">
          <img className="fits-ship-icon" src={fit.ship ? iconUrl(fit.ship.typeId) : ''} alt="" />
        </div>
        <div className="fits-title-block">
          <div className="fits-title-line">
            <strong>{fit.ship?.name ?? fit.headerShipName}</strong>
            <span className={props.saved ? 'fits-state saved' : 'fits-state draft'}>{props.saved ? 'Saved' : 'Draft'}</span>
            <span className={`fits-state ${props.visibility}`}>{props.visibility === 'public' ? 'Public' : 'Private'}</span>
            {fit.warnings.map((w, i) => <span key={`${w.code}-${i}`} className="fits-warn-badge">{w.code}</span>)}
          </div>
          <div className="fits-edit-grid">
            <input value={props.fitName} onChange={e => props.onName(e.target.value)} readOnly={!props.editable} />
            <input value={props.notes} onChange={e => props.onNotes(e.target.value)} placeholder="Notes" readOnly={!props.editable} />
          </div>
        </div>
        <div className="fits-actions">
          <div className="fits-action-row">
            {props.editable && <button onClick={props.onSave} disabled={props.busy}>{props.saved ? 'Save' : 'Save fit'}</button>}
            {props.canPublish && <button onClick={props.onPublish} disabled={props.busy}>Publish</button>}
            {props.canCopyPrivate && <button onClick={props.onCopyPrivate} disabled={props.busy}>Copy private</button>}
            <button onClick={props.onCopy}>Copy EFT</button>
            {props.saved && props.editable && <button className="danger" onClick={props.onDelete}>Delete</button>}
          </div>
          {props.status && <small className="fits-status">{props.status}</small>}
          {props.quoteError && <small className="fits-status err">{props.quoteError}</small>}
          {props.sendStatus.kind === 'sent' && <small className="fits-status ok">Fitting #{props.sendStatus.fittingId ?? 'created'} - {props.sendStatus.excludedCount} excluded</small>}
          {props.sendStatus.kind === 'error' && <small className="fits-status err">{props.sendStatus.message}{props.sendStatus.reauthHint ? ` - ${props.sendStatus.reauthHint}` : ''}</small>}
        </div>
      </div>
      <div className="fits-ship-controls">
        <div className="fits-cost-row">
          <strong className="fits-fit-cost">{fitCost}</strong>
          <button onClick={props.onRefresh} disabled={props.quoteLoading}>Refresh Price</button>
        </div>
        <div className="fits-send-row">
          <select value={props.pilotId ?? ''} onChange={e => props.onPilot(Number(e.target.value) || null)}>
            {props.chars.length === 0 && <option value="">No pilots</option>}
            {props.chars.map(c => <option key={c.characterId} value={c.characterId}>{c.name}{c.needsReauth ? ' (needs re-auth)' : ''}</option>)}
          </select>
          <button onClick={props.onSend} disabled={props.pilotId == null || props.sendStatus.kind === 'sending'}>
            {props.sendStatus.kind === 'sending' ? 'Sending...' : 'Send Fit'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SlotSection({ role, fit, tooltip }: { role: FitSectionRole; fit: FitDraft | SavedFitDetail; tooltip: FitTooltipHandlers }) {
  const section = fit.sections[role];
  if (!section || (section.slotCount === 0 && section.items.length === 0)) return null;
  const cells = Math.max(section.slotCount, section.items.length);
  return (
    <section className="fits-section">
      <h3>{section.label}<span>{section.items.length}/{section.slotCount}</span></h3>
      <div className="fits-slot-list">
        {Array.from({ length: cells }, (_, i) => {
          const item = section.items[i];
          return item ? <SlotItemRow key={item.id} item={item} over={i >= section.slotCount} tooltip={tooltip} /> : (
            <div key={i} className="fits-item-row fits-slot-empty">
              <div className="fits-item-icon" />
              <span>Empty slot</span>
              <small />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ExtraSection({ role, fit, tooltip }: { role: FitSectionRole; fit: FitDraft | SavedFitDetail; tooltip: FitTooltipHandlers }) {
  const section = fit.sections[role];
  if (!section || section.items.length === 0) return null;
  return (
    <section className="fits-section">
      <h3>{section.label}<span>{section.items.length}</span></h3>
      <div className="fits-extra-list">
        {section.items.map(item => <ItemRow key={item.id} item={item} tooltip={tooltip} />)}
      </div>
    </section>
  );
}

function SlotItemRow({ item, over, tooltip }: { item: AssignedFitItem; over?: boolean; tooltip: FitTooltipHandlers }) {
  const label = item.resolvedName ?? item.inputName;
  return (
    <div
      className={`fits-item-row fits-tooltip${over || item.warning ? ' warn' : ''}`}
      data-tooltip={item.resolvedName ?? item.inputName}
      aria-label={label}
      tabIndex={0}
      onPointerEnter={e => tooltip.show(label, e.currentTarget)}
      onPointerMove={e => tooltip.show(label, e.currentTarget)}
      onPointerLeave={tooltip.hide}
      onFocus={e => tooltip.show(label, e.currentTarget)}
      onBlur={tooltip.hide}
    >
      <div className="fits-item-icon">{item.typeId ? <img src={iconUrl(item.typeId)} alt="" /> : '?'}</div>
      <span>{label}</span>
      <small>{item.quantity > 1 ? item.quantity.toLocaleString() : over ? 'over' : ''}</small>
    </div>
  );
}

function ItemRow({ item, tooltip }: { item: AssignedFitItem; tooltip: FitTooltipHandlers }) {
  const label = item.resolvedName ?? item.inputName;
  return (
    <div
      className={`fits-item-row fits-tooltip${item.warning ? ' warn' : ''}`}
      data-tooltip={item.resolvedName ?? item.inputName}
      aria-label={label}
      tabIndex={0}
      onPointerEnter={e => tooltip.show(label, e.currentTarget)}
      onPointerMove={e => tooltip.show(label, e.currentTarget)}
      onPointerLeave={tooltip.hide}
      onFocus={e => tooltip.show(label, e.currentTarget)}
      onBlur={tooltip.hide}
    >
      <div className="fits-item-icon">{item.typeId ? <img src={iconUrl(item.typeId)} alt="" /> : '?'}</div>
      <span>{label}</span>
      <small>{item.quantity.toLocaleString()}</small>
    </div>
  );
}

function FitTooltip({ tooltip }: { tooltip: NonNullable<FitTooltipState> }) {
  return (
    <div className="fits-floating-tooltip" role="tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
      {tooltip.label}
    </div>
  );
}

function PricePanel({ quote, loading, error }: { quote: FitQuote | null; loading: boolean; error: string | null }) {
  return (
    <aside className="fits-price">
      <h3>Price</h3>
      {loading && <div className="fits-empty">Pricing...</div>}
      {error && <div className="fits-alert err">{error}</div>}
      {quote && (
        <>
          <PriceLine label="Hull" value={quote.totals.hull} />
          <PriceLine label="Fitted" value={quote.totals.fitted} />
          <PriceLine label="Extras" value={quote.totals.extras} />
          <PriceLine label="Grand total" value={quote.totals.grand} strong />
          <div className="fits-price-meta">{quote.systemName} - {quote.counts.ok} priced - {quote.counts.noOrders} no sellers</div>
        </>
      )}
    </aside>
  );
}

function FitDoctrinesPanel({ doctrines, loading, onOpen }: { doctrines: DoctrineSummary[]; loading: boolean; onOpen: (doctrine: DoctrineSummary) => void }) {
  return (
    <aside className="fits-doctrines">
      <h3>Doctrines<span>{doctrines.length}</span></h3>
      {loading && <div className="fits-empty">Loading doctrines...</div>}
      {!loading && doctrines.length === 0 && <div className="fits-empty">Not in any doctrines.</div>}
      {!loading && doctrines.map(doctrine => (
        <button key={doctrine.id} className="fit-doctrine-link" onClick={() => onOpen(doctrine)}>
          <strong>{doctrine.name}</strong>
          <span>{doctrine.description || doctrine.shipNames.join(', ') || 'No description'}</span>
          <small>{doctrine.fitCount} fits - {doctrine.visibility === 'public' ? 'Public' : 'Private'}</small>
        </button>
      ))}
    </aside>
  );
}

function PriceLine({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return <div className={`fits-price-line${strong ? ' strong' : ''}`}><span>{label}</span><b>{formatIsk(value)} ISK</b></div>;
}

function isPyfaImageMimeType(value: string): value is PyfaImageImportRequest['mimeType'] {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp';
}

function imageFileFromList(files: FileList): File | null {
  return Array.from(files).find(file => isPyfaImageMimeType(file.type)) ?? null;
}

function imageExtension(mimeType: PyfaImageImportRequest['mimeType']): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const value = String(reader.result ?? '');
      const commaIndex = value.indexOf(',');
      resolve(commaIndex >= 0 ? value.slice(commaIndex + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fits-modal-backdrop">
      <div className="fits-modal">
        <div className="fits-modal-head"><strong>{title}</strong><button onClick={onClose}>x</button></div>
        {children}
      </div>
    </div>
  );
}

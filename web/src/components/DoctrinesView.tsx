import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoctrineFit,
  copyDoctrineToPrivate,
  createDoctrine,
  deleteDoctrine,
  fetchDoctrine,
  fetchDoctrines,
  fetchFits,
  publishDoctrine,
  refreshDoctrineFits,
  removeDoctrineFit,
  updateDoctrine,
  type CurrentUser,
  type DoctrineDetail,
  type DoctrineFitRefreshResult,
  type DoctrineSummary,
  type LibraryVisibility,
  type SavedFitSummary,
} from '../api.ts';

interface Props {
  currentUser: CurrentUser;
  visibility: LibraryVisibility;
  setVisibility: (visibility: LibraryVisibility) => void;
  onOpenFit: (fit: SavedFitSummary) => void;
  routeDoctrineId: number | null;
  onOpenDoctrineRoute: (id: number) => void;
  onModeRoute: (mode: 'fits' | 'doctrines') => void;
}

function iconUrl(typeId: number): string {
  return `https://images.evetech.net/types/${typeId}/icon?size=64`;
}

function warningCount(fit: SavedFitSummary): number {
  return fit.warningCounts.unmatched + fit.warningCounts.overSlot + fit.warningCounts.unassignable;
}

function googleDocPreviewUrl(url: string): string | null {
  const match = /^https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)/.exec(url.trim());
  return match ? `https://docs.google.com/document/d/${match[1]}/preview` : null;
}

export function DoctrinesView({ currentUser, visibility, setVisibility, onOpenFit, routeDoctrineId, onOpenDoctrineRoute, onModeRoute }: Props) {
  const [query, setQuery] = useState('');
  const [doctrines, setDoctrines] = useState<DoctrineSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DoctrineDetail | null>(null);
  const [draftMode, setDraftMode] = useState(false);
  const draftModeRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [googleDocUrl, setGoogleDocUrl] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshingFits, setRefreshingFits] = useState(false);
  const [refreshResult, setRefreshResult] = useState<DoctrineFitRefreshResult | null>(null);
  const [fitQuery, setFitQuery] = useState('');
  const [savedFits, setSavedFits] = useState<SavedFitSummary[]>([]);
  const [activeGoogleDocTabId, setActiveGoogleDocTabId] = useState('default');

  async function reloadList(q = query, scope = visibility) {
    const rows = await fetchDoctrines(q, scope);
    setDoctrines(rows);
    setSelectedId(current => {
      if (draftModeRef.current) return current;
      if (routeDoctrineId != null) return routeDoctrineId;
      return (current != null && rows.some(row => row.id === current)) ? current : rows[0]?.id ?? null;
    });
  }

  function leaveDraftMode() {
    draftModeRef.current = false;
    setDraftMode(false);
    setEditing(false);
  }

  useEffect(() => {
    leaveDraftMode();
    setDetail(null);
    setSelectedId(routeDoctrineId);
    reloadList(query, visibility);
  }, [visibility]);
  useEffect(() => {
    const t = window.setTimeout(() => reloadList(query, visibility), 150);
    return () => window.clearTimeout(t);
  }, [query, visibility]);

  useEffect(() => {
    fetchFits(visibility).then(setSavedFits).catch(() => setSavedFits([]));
  }, [visibility]);

  useEffect(() => {
    if (selectedId == null) { setDetail(null); return; }
    let cancelled = false;
    fetchDoctrine(selectedId).then(res => {
      if (cancelled) return;
      if ('error' in res) setDetail(null);
      else {
        setDetail(res);
        if (routeDoctrineId === res.id && res.visibility !== visibility) setVisibility(res.visibility);
      }
    });
    return () => { cancelled = true; };
  }, [selectedId, routeDoctrineId, visibility]);

  useEffect(() => {
    if (routeDoctrineId == null) return;
    leaveDraftMode();
    setQuery('');
    setDetail(null);
    setSelectedId(routeDoctrineId);
  }, [routeDoctrineId]);

  useEffect(() => {
    setName(detail?.name ?? '');
    setDescription(detail?.description ?? '');
    setGoogleDocUrl(detail?.googleDocUrl ?? '');
    setEditing(false);
    setStatus(null);
    setRefreshResult(null);
    setActiveGoogleDocTabId(detail?.tabs[0]?.id ?? 'default');
  }, [detail?.id]);

  useEffect(() => {
    const tabs = detail?.tabs ?? [];
    if (tabs.length === 0) return;
    if (!tabs.some(tab => tab.id === activeGoogleDocTabId)) setActiveGoogleDocTabId(tabs[0].id);
  }, [detail?.tabs, activeGoogleDocTabId]);

  const availableFits = useMemo(() => {
    const q = fitQuery.trim().toLowerCase();
    const used = new Set(!draftMode ? detail?.fits.filter(fit => fit.googleDocTabId === activeGoogleDocTabId).map(fit => fit.id) ?? [] : []);
    return savedFits
      .filter(fit => !used.has(fit.id))
      .filter(fit => !q || `${fit.shipName} ${fit.fitName}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [savedFits, fitQuery, detail?.fits, draftMode, activeGoogleDocTabId]);

  const canStartEditing = !!detail && (currentUser.role === 'admin' || detail.ownerUserId === currentUser.id);
  const isEditing = draftMode || editing;
  const canSaveDoctrine = draftMode || (editing && canStartEditing);
  const canPublishDoctrine = !!detail && canStartEditing && detail.visibility === 'private';
  const canCopyDoctrine = !!detail && detail.visibility === 'public';
  const canRefreshFits = !!detail && canStartEditing && !!detail.googleDocUrl.trim();
  const showEditor = draftMode || !!detail;
  const editorVisibility = draftMode ? visibility : detail?.visibility ?? visibility;
  const googleDocTabs = draftMode ? [] : detail?.tabs ?? [];
  const activeGoogleDocTab = googleDocTabs.find(tab => tab.id === activeGoogleDocTabId) ?? googleDocTabs[0] ?? { id: 'default', title: 'Fits', sortOrder: 0, fitCount: 0 };
  const visibleDoctrineFits = draftMode ? [] : detail?.fits.filter(fit => fit.googleDocTabId === activeGoogleDocTab.id) ?? [];
  const editorFits = visibleDoctrineFits;
  const editorFitCount = visibleDoctrineFits.length;
  const docPreviewUrl = googleDocPreviewUrl(detail?.googleDocUrl ?? googleDocUrl);

  function createNewDoctrine() {
    draftModeRef.current = true;
    setDraftMode(true);
    setSelectedId(null);
    setDetail(null);
    setName('');
    setDescription('');
    setGoogleDocUrl('');
    setFitQuery('');
    setStatus(null);
    setRefreshResult(null);
    setActiveGoogleDocTabId('default');
    setQuery('');
    onModeRoute('doctrines');
  }

  async function publishCurrentDoctrine() {
    if (!detail) return;
    setBusy(true);
    setStatus(null);
    const res = await publishDoctrine(detail.id);
    setBusy(false);
    if ('error' in res) { setStatus(res.error); return; }
    setVisibility('public');
    setSelectedId(res.id);
    setDetail(res);
    onOpenDoctrineRoute(res.id);
    setStatus('Published.');
    await reloadList(query, 'public');
  }

  async function copyCurrentDoctrineToPrivate() {
    if (!detail) return;
    setBusy(true);
    setStatus(null);
    const res = await copyDoctrineToPrivate(detail.id);
    setBusy(false);
    if ('error' in res) { setStatus(res.error); return; }
    setVisibility('private');
    setSelectedId(res.id);
    setDetail(res);
    onOpenDoctrineRoute(res.id);
    setStatus('Copied to private library.');
    await reloadList('', 'private');
  }

  async function refreshFitsFromGoogleDoc() {
    if (!detail || !canRefreshFits || refreshingFits) return;
    setRefreshingFits(true);
    setStatus(null);
    setRefreshResult(null);
    const res = await refreshDoctrineFits(detail.id);
    setRefreshingFits(false);
    if ('error' in res) { setStatus(res.error); return; }
    setDetail(res.doctrine);
    setSelectedId(res.doctrine.id);
    setActiveGoogleDocTabId(current => res.doctrine.tabs.some(tab => tab.id === current) ? current : res.doctrine.tabs[0]?.id ?? 'default');
    setRefreshResult(res);
    const changed = res.updated.length + res.created.length;
    setStatus(`Refresh complete: ${res.updated.length} updated, ${res.created.length} created${changed === 0 ? ', no changes' : ''}.`);
    await reloadList(query, res.doctrine.visibility);
  }

  async function saveDoctrine() {
    if (!canSaveDoctrine) return;
    const trimmedName = name.trim();
    if (!trimmedName) { setStatus('Doctrine name is required.'); return; }
    setBusy(true);
    setStatus(null);
    const res = draftMode
      ? await createDoctrine({ name: trimmedName, description, googleDocUrl, visibility })
      : detail
        ? await updateDoctrine(detail.id, { name: trimmedName, description, googleDocUrl })
        : { error: 'No doctrine selected.' };
    setBusy(false);
    if ('error' in res) { setStatus(res.error); return; }
    leaveDraftMode();
    setEditing(false);
    setDetail(res);
    setSelectedId(res.id);
    onOpenDoctrineRoute(res.id);
    setStatus('Saved.');
    await reloadList('', res.visibility);
  }

  async function removeDoctrine() {
    if (draftMode) {
      leaveDraftMode();
      setName('');
      setDescription('');
      setGoogleDocUrl('');
      setStatus(null);
      return;
    }
    if (!detail) return;
    if (!confirm('Delete this doctrine? Saved fits will not be deleted.')) return;
    const res = await deleteDoctrine(detail.id);
    if ('error' in res) { setStatus(res.error); return; }
    setSelectedId(null);
    setDetail(null);
    onModeRoute('doctrines');
    await reloadList();
  }

  function cancelEditing() {
    setName(detail?.name ?? '');
    setDescription(detail?.description ?? '');
    setGoogleDocUrl(detail?.googleDocUrl ?? '');
    setEditing(false);
    setStatus(null);
    setRefreshResult(null);
  }

  async function addFit(fitId: number) {
    if (!detail) return;
    const res = await addDoctrineFit(detail.id, fitId, activeGoogleDocTab);
    if ('error' in res) { setStatus(res.error); return; }
    setDetail(res);
    setFitQuery('');
    await reloadList();
  }

  async function removeFit(fitId: number) {
    if (!detail) return;
    const res = await removeDoctrineFit(detail.id, fitId, activeGoogleDocTab.id);
    if ('error' in res) { setStatus(res.error); return; }
    setDetail(res);
    await reloadList();
  }

  return (
    <div className="fits-view">
      <aside className="fits-library doctrine-library">
        <div className="fits-lib-head">
          <strong>Doctrines</strong>
          <button className="fl-refresh" onClick={createNewDoctrine} disabled={busy}>Create doctrine</button>
        </div>
        <input className="fits-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search doctrines" />
        <div className="fits-list">
          {doctrines.map(row => (
            <button key={row.id} className={`fits-row${selectedId === row.id && !draftMode ? ' active' : ''}`} onClick={() => { leaveDraftMode(); setSelectedId(row.id); onOpenDoctrineRoute(row.id); }}>
              <span className="fits-row-ship">{row.name}</span>
              <span className="fits-row-name">{row.description || row.shipNames.join(', ') || 'No description'}</span>
              <span className="fits-row-meta">{row.fitCount} fits - {row.visibility === 'public' ? 'Public' : 'Private'}</span>
            </button>
          ))}
          {doctrines.length === 0 && <div className="fits-empty">Create a doctrine from saved fits.</div>}
        </div>
      </aside>

      <section className="fits-detail doctrine-detail">
        {!showEditor && <div className="fits-empty large">Create a doctrine from saved fits.</div>}
        {showEditor && (
          <>
            <div className={`doctrine-head ${isEditing ? 'editing' : 'viewing'}`}>
              <div className="doctrine-fields">
                <div className="fits-title-line">
                  {draftMode && <span className="fits-state draft">Draft</span>}
                  <span className={`fits-state ${editorVisibility}`}>{editorVisibility === 'public' ? 'Public' : 'Private'}</span>
                </div>
                {isEditing ? (
                  <>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="New doctrine" />
                    <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description of how this doctrine works" />
                    <label className="doctrine-field-label">
                      <span>Google Doc URL</span>
                      <input value={googleDocUrl} onChange={e => setGoogleDocUrl(e.target.value)} placeholder="https://docs.google.com/document/d/..." />
                    </label>
                  </>
                ) : (
                  <div className="doctrine-view-summary">
                    <h2>{detail?.name}</h2>
                    <div className="doctrine-description-view">
                      {docPreviewUrl
                        ? <iframe className="google-doc-frame" src={docPreviewUrl} title={`${detail?.name ?? 'Doctrine'} description`} />
                        : detail?.description
                          ? <p>{detail.description}</p>
                          : <p>No description provided.</p>}
                    </div>
                  </div>
                )}
              </div>
              <div className="fits-actions">
                {canStartEditing && !isEditing && <button onClick={() => setEditing(true)} disabled={busy}>Edit</button>}
                {canSaveDoctrine && <button onClick={saveDoctrine} disabled={busy}>Save</button>}
                {editing && <button onClick={cancelEditing} disabled={busy}>Cancel</button>}
                {canStartEditing && !draftMode && <button onClick={refreshFitsFromGoogleDoc} disabled={!canRefreshFits || busy || refreshingFits}>{refreshingFits ? 'Refreshing...' : 'Refresh Fits'}</button>}
                {canPublishDoctrine && <button onClick={publishCurrentDoctrine} disabled={busy}>Publish</button>}
                {canCopyDoctrine && <button onClick={copyCurrentDoctrineToPrivate} disabled={busy}>Copy private</button>}
                {isEditing && canSaveDoctrine && <button className="danger" onClick={removeDoctrine}>{draftMode ? 'Discard' : 'Delete'}</button>}
                {status && <small className={statusClassName(status)}>{status}</small>}
              </div>
            </div>

            {refreshResult && <DoctrineRefreshSummary result={refreshResult} />}

            {!draftMode && googleDocTabs.length > 0 && (
              <section className="doctrine-doc-tabs-wrap">
                <div className="doctrine-doc-tabs-head">
                  <span>Active Google Doc tab</span>
                  <strong>{activeGoogleDocTab.title}</strong>
                </div>
                <div className="doctrine-doc-tabs" aria-label="Google Doc tabs">
                  {googleDocTabs.map(tab => (
                    <button
                      key={tab.id}
                      className={tab.id === activeGoogleDocTab.id ? 'active' : ''}
                      aria-pressed={tab.id === activeGoogleDocTab.id}
                      onClick={() => setActiveGoogleDocTabId(tab.id)}
                    >
                      <span>{tab.title}</span>
                      <small>{tab.fitCount}</small>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {draftMode && (
              <section className="doctrine-add">
                <h3>Add fit</h3>
                <div className="fits-empty">Save the doctrine before adding fits.</div>
              </section>
            )}
            {!draftMode && isEditing && canStartEditing && (
              <section className="doctrine-add">
                <h3>Add fit</h3>
                <input value={fitQuery} onChange={e => setFitQuery(e.target.value)} placeholder="Search saved fits by ship or fit name" />
                {fitQuery.trim() && (
                  <div className="doctrine-fit-results">
                    {availableFits.map(fit => (
                      <button key={fit.id} onClick={() => addFit(fit.id)}>
                        <img src={iconUrl(fit.shipTypeId)} alt="" />
                        <span><b>{fit.shipName}</b><small>{fit.fitName}</small></span>
                      </button>
                    ))}
                    {availableFits.length === 0 && <div className="fits-empty">No saved fits found.</div>}
                  </div>
                )}
              </section>
            )}

            <section className="doctrine-members">
              <h3>Fits <span>{editorFitCount}{detail && detail.fitCount !== editorFitCount ? ` / ${detail.fitCount}` : ''}</span></h3>
              <div className="doctrine-member-grid">
                {editorFits.map(fit => (
                  <div className="doctrine-member" key={fit.id}>
                    <button className="doctrine-member-open" onClick={() => onOpenFit(fit)}>
                      <img src={iconUrl(fit.shipTypeId)} alt="" />
                      <span>
                        <strong>{fit.shipName}</strong>
                        <small>{fit.fitName}</small>
                        {warningCount(fit) > 0 && <small>{warningCount(fit)} warnings</small>}
                      </span>
                    </button>
                    {isEditing && canStartEditing && <button onClick={() => removeFit(fit.id)}>Remove</button>}
                  </div>
                ))}
                {editorFits.length === 0 && <div className="fits-empty">No fits in this doctrine yet.</div>}
              </div>
            </section>
          </>
        )}
      </section>
    </div>
  );
}

function statusClassName(status: string): string {
  return /^Saved\.|^Published\.|^Copied to private library\.|^Refresh complete:/.test(status)
    ? 'fits-status ok'
    : 'fits-status err';
}

function DoctrineRefreshSummary({ result }: { result: DoctrineFitRefreshResult }) {
  const issueCount = result.ambiguous.length + result.failed.length + result.skipped.length;
  return (
    <section className="doctrine-refresh-summary">
      <strong>Google Doc fit refresh</strong>
      <div>
        <span>{result.updated.length} updated</span>
        <span>{result.created.length} created</span>
        <span>{issueCount} needs review</span>
      </div>
      {(result.created.length > 0 || result.updated.length > 0) && (
        <ul>
          {result.updated.slice(0, 4).map(fit => <li key={`updated-${fit.fitId}`}>Updated {fit.shipName} - {fit.fitName}</li>)}
          {result.created.slice(0, 4).map(fit => <li key={`created-${fit.fitId}`}>Created {fit.shipName} - {fit.fitName}</li>)}
        </ul>
      )}
      {issueCount > 0 && (
        <ul>
          {result.ambiguous.map(row => <li key={`ambiguous-${row.fitName}`}>Ambiguous: {row.fitName} matched {row.matchedFitIds.length} saved fits</li>)}
          {result.failed.map(row => <li key={`failed-${row.fitName}`}>Failed: {row.fitName} - {row.error}</li>)}
          {result.skipped.map((row, i) => <li key={`skipped-${row.fitName}-${i}`}>Skipped: {row.fitName || 'Document'} - {row.reason}</li>)}
        </ul>
      )}
    </section>
  );
}

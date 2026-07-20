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
  removeDoctrineFit,
  updateDoctrine,
  type CurrentUser,
  type DoctrineDetail,
  type DoctrineSummary,
  type LibraryVisibility,
  type SavedFitSummary,
} from '../api.ts';

interface Props {
  currentUser: CurrentUser;
  visibility: LibraryVisibility;
  setVisibility: (visibility: LibraryVisibility) => void;
  onOpenFit: (fit: SavedFitSummary) => void;
  openDoctrineTarget: { id: number; visibility: LibraryVisibility } | null;
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

export function DoctrinesView({ currentUser, visibility, setVisibility, onOpenFit, openDoctrineTarget }: Props) {
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
  const [fitQuery, setFitQuery] = useState('');
  const [savedFits, setSavedFits] = useState<SavedFitSummary[]>([]);

  async function reloadList(q = query, scope = visibility) {
    const rows = await fetchDoctrines(q, scope);
    setDoctrines(rows);
    setSelectedId(current => {
      if (draftModeRef.current) return current;
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
    setSelectedId(null);
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
      else setDetail(res);
    });
    return () => { cancelled = true; };
  }, [selectedId]);

  useEffect(() => {
    if (!openDoctrineTarget) return;
    leaveDraftMode();
    setQuery('');
    setDetail(null);
    setSelectedId(openDoctrineTarget.id);
  }, [openDoctrineTarget]);

  useEffect(() => {
    setName(detail?.name ?? '');
    setDescription(detail?.description ?? '');
    setGoogleDocUrl(detail?.googleDocUrl ?? '');
    setEditing(false);
    setStatus(null);
  }, [detail?.id]);

  const availableFits = useMemo(() => {
    const q = fitQuery.trim().toLowerCase();
    const used = new Set(!draftMode ? detail?.fits.map(fit => fit.id) ?? [] : []);
    return savedFits
      .filter(fit => !used.has(fit.id))
      .filter(fit => !q || `${fit.shipName} ${fit.fitName}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [savedFits, fitQuery, detail?.fits, draftMode]);

  const canStartEditing = !!detail && (currentUser.role === 'admin' || detail.ownerUserId === currentUser.id);
  const isEditing = draftMode || editing;
  const canSaveDoctrine = draftMode || (editing && canStartEditing);
  const canPublishDoctrine = !!detail && canStartEditing && detail.visibility === 'private';
  const canCopyDoctrine = !!detail && detail.visibility === 'public';
  const showEditor = draftMode || !!detail;
  const editorVisibility = draftMode ? visibility : detail?.visibility ?? visibility;
  const editorFits = draftMode ? [] : detail?.fits ?? [];
  const editorFitCount = draftMode ? 0 : detail?.fitCount ?? 0;
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
    setQuery('');
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
    setStatus('Copied to private library.');
    await reloadList('', 'private');
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
    await reloadList();
  }

  function cancelEditing() {
    setName(detail?.name ?? '');
    setDescription(detail?.description ?? '');
    setGoogleDocUrl(detail?.googleDocUrl ?? '');
    setEditing(false);
    setStatus(null);
  }

  async function addFit(fitId: number) {
    if (!detail) return;
    const res = await addDoctrineFit(detail.id, fitId);
    if ('error' in res) { setStatus(res.error); return; }
    setDetail(res);
    setFitQuery('');
    await reloadList();
  }

  async function removeFit(fitId: number) {
    if (!detail) return;
    const res = await removeDoctrineFit(detail.id, fitId);
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
            <button key={row.id} className={`fits-row${selectedId === row.id && !draftMode ? ' active' : ''}`} onClick={() => { leaveDraftMode(); setSelectedId(row.id); }}>
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
                {canPublishDoctrine && <button onClick={publishCurrentDoctrine} disabled={busy}>Publish</button>}
                {canCopyDoctrine && <button onClick={copyCurrentDoctrineToPrivate} disabled={busy}>Copy private</button>}
                {isEditing && canSaveDoctrine && <button className="danger" onClick={removeDoctrine}>{draftMode ? 'Discard' : 'Delete'}</button>}
                {status && <small className={['Saved.', 'Published.', 'Copied to private library.'].includes(status) ? 'fits-status ok' : 'fits-status err'}>{status}</small>}
              </div>
            </div>

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
              <h3>Fits <span>{editorFitCount}</span></h3>
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

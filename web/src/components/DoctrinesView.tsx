import { useEffect, useMemo, useState } from 'react';
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
import { FitModeSwitch, type FitMode } from './FitModeSwitch.tsx';
import { LibraryScopeSwitch } from './LibraryScopeSwitch.tsx';

interface Props {
  mode: FitMode;
  onMode: (mode: FitMode) => void;
  currentUser: CurrentUser;
}

const DOCTRINE_VISIBILITY_KEY = 'efd.doctrines.visibility';

function iconUrl(typeId: number): string {
  return `https://images.evetech.net/types/${typeId}/icon?size=64`;
}

function warningCount(fit: SavedFitSummary): number {
  return fit.warningCounts.unmatched + fit.warningCounts.overSlot + fit.warningCounts.unassignable;
}

export function DoctrinesView({ mode, onMode, currentUser }: Props) {
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState<LibraryVisibility>(() => (localStorage.getItem(DOCTRINE_VISIBILITY_KEY) as LibraryVisibility) || 'private');
  const [doctrines, setDoctrines] = useState<DoctrineSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DoctrineDetail | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fitQuery, setFitQuery] = useState('');
  const [savedFits, setSavedFits] = useState<SavedFitSummary[]>([]);

  async function reloadList(q = query, scope = visibility) {
    const rows = await fetchDoctrines(q, scope);
    setDoctrines(rows);
    setSelectedId(current => (current != null && rows.some(row => row.id === current)) ? current : rows[0]?.id ?? null);
  }

  useEffect(() => { localStorage.setItem(DOCTRINE_VISIBILITY_KEY, visibility); }, [visibility]);
  useEffect(() => {
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
    setName(detail?.name ?? '');
    setDescription(detail?.description ?? '');
    setStatus(null);
  }, [detail?.id]);

  const availableFits = useMemo(() => {
    const q = fitQuery.trim().toLowerCase();
    const used = new Set(detail?.fits.map(fit => fit.id) ?? []);
    return savedFits
      .filter(fit => !used.has(fit.id))
      .filter(fit => !q || `${fit.shipName} ${fit.fitName}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [savedFits, fitQuery, detail?.fits]);

  const canEditDoctrine = !detail || currentUser.role === 'admin' || detail.ownerUserId === currentUser.id;
  const canPublishDoctrine = !!detail && canEditDoctrine && detail.visibility === 'private';
  const canCopyDoctrine = !!detail && detail.visibility === 'public';

  async function createNewDoctrine() {
    setBusy(true);
    setStatus(null);
    const res = await createDoctrine({ name: 'New Doctrine', description: '', visibility });
    setBusy(false);
    if ('error' in res) { setStatus(res.error); return; }
    setSelectedId(res.id);
    setDetail(res);
    setQuery('');
    await reloadList('');
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
    if (!detail) return;
    setBusy(true);
    const res = await updateDoctrine(detail.id, { name, description });
    setBusy(false);
    if ('error' in res) { setStatus(res.error); return; }
    setDetail(res);
    setStatus('Saved.');
    await reloadList();
  }

  async function removeDoctrine() {
    if (!detail) return;
    if (!confirm('Delete this doctrine? Saved fits will not be deleted.')) return;
    const res = await deleteDoctrine(detail.id);
    if ('error' in res) { setStatus(res.error); return; }
    setSelectedId(null);
    setDetail(null);
    await reloadList();
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
    <main className="rows-wrap fits-view">
      <aside className="fits-library doctrine-library">
        <FitModeSwitch mode={mode} onMode={onMode} />
        <div className="fits-lib-head">
          <strong>Doctrines</strong>
          <button className="fl-refresh" onClick={createNewDoctrine} disabled={busy}>Create doctrine</button>
        </div>
        <LibraryScopeSwitch value={visibility} onChange={setVisibility} />
        <input className="fits-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search doctrines" />
        <div className="fits-list">
          {doctrines.map(row => (
            <button key={row.id} className={`fits-row${selectedId === row.id ? ' active' : ''}`} onClick={() => setSelectedId(row.id)}>
              <span className="fits-row-ship">{row.name}</span>
              <span className="fits-row-name">{row.description || row.shipNames.join(', ') || 'No description'}</span>
              <span className="fits-row-meta">{row.fitCount} fits - {row.visibility === 'public' ? 'Public' : 'Private'}</span>
            </button>
          ))}
          {doctrines.length === 0 && <div className="fits-empty">Create a doctrine from saved fits.</div>}
        </div>
      </aside>

      <section className="fits-detail doctrine-detail">
        {!detail && <div className="fits-empty large">Create a doctrine from saved fits.</div>}
        {detail && (
          <>
            <div className="doctrine-head">
              <div className="doctrine-fields">
                <div className="fits-title-line">
                  <span className={`fits-state ${detail.visibility}`}>{detail.visibility === 'public' ? 'Public' : 'Private'}</span>
                </div>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Doctrine name" readOnly={!canEditDoctrine} />
                <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description of how this doctrine works" readOnly={!canEditDoctrine} />
              </div>
              <div className="fits-actions">
                {canEditDoctrine && <button onClick={saveDoctrine} disabled={busy}>Save</button>}
                {canPublishDoctrine && <button onClick={publishCurrentDoctrine} disabled={busy}>Publish</button>}
                {canCopyDoctrine && <button onClick={copyCurrentDoctrineToPrivate} disabled={busy}>Copy private</button>}
                {canEditDoctrine && <button className="danger" onClick={removeDoctrine}>Delete</button>}
                {status && <small className={['Saved.', 'Published.', 'Copied to private library.'].includes(status) ? 'fits-status ok' : 'fits-status err'}>{status}</small>}
              </div>
            </div>

            {canEditDoctrine && (
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
              <h3>Fits <span>{detail.fitCount}</span></h3>
              <div className="doctrine-member-grid">
                {detail.fits.map(fit => (
                  <div className="doctrine-member" key={fit.id}>
                    <img src={iconUrl(fit.shipTypeId)} alt="" />
                    <div>
                      <strong>{fit.shipName}</strong>
                      <span>{fit.fitName}</span>
                      {warningCount(fit) > 0 && <small>{warningCount(fit)} warnings</small>}
                    </div>
                    {canEditDoctrine && <button onClick={() => removeFit(fit.id)}>Remove</button>}
                  </div>
                ))}
                {detail.fits.length === 0 && <div className="fits-empty">No fits in this doctrine yet.</div>}
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCharacters } from './hooks/useCharacters.ts';
import { useTableState, type SortKey, type ColKey } from './hooks/useTableState.ts';
import { CharacterCard } from './components/CharacterCard.tsx';
import { ControlPanel } from './components/ControlPanel.tsx';
import { PlanetsView } from './components/PlanetsView.tsx';
import { SkillsView } from './components/SkillsView.tsx';
import { FleetView } from './components/FleetView.tsx';
import { MarketView } from './components/MarketView.tsx';
import { IndustryView } from './components/IndustryView.tsx';
import { ContractsView } from './components/ContractsView.tsx';
import { FitsView } from './components/FitsView.tsx';
import { AssetsView } from './components/AssetsView.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { deleteCharacter, fetchCurrentUser, logout, setBoss, setMainCharacter, type CharacterStatus, type CurrentUser } from './api.ts';

type View = 'pilots' | 'planets' | 'skills' | 'fleet' | 'market' | 'industry' | 'contracts' | 'fits' | 'assets';

interface HeaderDef {
  key: SortKey;
  col: ColKey;
  label: string;
  align?: 'right';
}

const HEADERS: HeaderDef[] = [
  { key: 'name', col: 'name', label: 'Character' },
  { key: 'location', col: 'location', label: 'Location' },
  { key: 'ship', col: 'ship', label: 'Ship' },
  { key: 'wallet', col: 'wallet', label: 'Wallet', align: 'right' },
  { key: 'training', col: 'training', label: 'Training' },
  { key: 'sp', col: 'sp', label: 'SP', align: 'right' },
  { key: 'unallocated', col: 'unallocated', label: 'Free', align: 'right' },
  { key: 'implants', col: 'implants', label: 'Implants', align: 'right' },
];

function formatShortIsk(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toFixed(0);
}

function formatShortSp(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
}

function compare(a: CharacterStatus, b: CharacterStatus, key: SortKey): number {
  switch (key) {
    case 'name': return a.name.localeCompare(b.name);
    case 'location': return (a.locationSystemName ?? '~').localeCompare(b.locationSystemName ?? '~');
    case 'ship': return (a.shipTypeName ?? '~').localeCompare(b.shipTypeName ?? '~');
    case 'wallet': return (a.walletBalance ?? -1) - (b.walletBalance ?? -1);
    case 'training': {
      const at = a.trainingFinishDate ? Date.parse(a.trainingFinishDate) : Number.POSITIVE_INFINITY;
      const bt = b.trainingFinishDate ? Date.parse(b.trainingFinishDate) : Number.POSITIVE_INFINITY;
      return at - bt;
    }
    case 'sp': return (a.totalSp ?? -1) - (b.totalSp ?? -1);
    case 'unallocated': return (a.unallocatedSp ?? -1) - (b.unallocatedSp ?? -1);
    case 'implants': return a.implantNames.length - b.implantNames.length;
  }
}

export function App() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null | undefined>(undefined);
  const { chars, loading, refresh } = useCharacters(currentUser != null);
  const table = useTableState();

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then(user => { if (!cancelled) setCurrentUser(user); })
      .catch(() => { if (!cancelled) setCurrentUser(null); });
    return () => { cancelled = true; };
  }, []);

  const [view, setView] = useState<View>(() => (localStorage.getItem('efd.view') as View) || 'pilots');
  useEffect(() => { localStorage.setItem('efd.view', view); }, [view]);

  const list = useMemo(() => {
    const arr = Array.from(chars.values());
    arr.sort((a, b) => {
      const c = compare(a, b, table.sortKey);
      return table.sortAsc ? c : -c;
    });
    return arr;
  }, [chars, table.sortKey, table.sortAsc]);

  const [selection, setSelection] = useState<Set<number>>(new Set());
  const knownIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const known = knownIdsRef.current;
    const currentIds = new Set(list.map(c => c.characterId));
    const added: number[] = [];
    for (const id of currentIds) if (!known.has(id)) added.push(id);
    const removed: number[] = [];
    for (const id of known) if (!currentIds.has(id)) removed.push(id);
    if (added.length === 0 && removed.length === 0) return;

    setSelection(prev => {
      const next = new Set(prev);
      for (const id of added) next.add(id);
      for (const id of removed) next.delete(id);
      return next;
    });
    knownIdsRef.current = currentIds;
  }, [list]);

  const onToggle = (id: number) => {
    setSelection(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const onToggleAll = () => {
    setSelection(prev => (prev.size === list.length ? new Set() : new Set(list.map(c => c.characterId))));
  };
  const onRemove = async (id: number) => {
    if (!confirm('Remove this character?')) return;
    await deleteCharacter(id); await refresh();
  };
  const onSetBoss = async (id: number) => { await setBoss(id); await refresh(); };

  const boss = list.find(c => c.isBoss);
  const bossFleetId = boss?.fleetId ?? null;
  const allSelected = list.length > 0 && selection.size === list.length;

  const totalWallet = list.reduce((n, c) => n + (c.walletBalance ?? 0), 0);
  const totalSp = list.reduce((n, c) => n + (c.totalSp ?? 0), 0);
  const totalUnalloc = list.reduce((n, c) => n + (c.unallocatedSp ?? 0), 0);

  const onLogout = async () => {
    await logout();
    setCurrentUser(null);
  };
  const onSetMainCharacter = async (characterId: number | null) => {
    if (!currentUser) return;
    const result = await setMainCharacter(characterId);
    if ('error' in result) {
      alert(result.error);
      return;
    }
    setCurrentUser({ ...currentUser, mainCharacterId: result.mainCharacterId });
  };

  const totals: Partial<Record<SortKey, string>> = {
    wallet: list.length ? formatShortIsk(totalWallet) : undefined,
    sp: list.length ? formatShortSp(totalSp) : undefined,
    unallocated: list.length && totalUnalloc > 0 ? formatShortSp(totalUnalloc) : undefined,
  };

  if (currentUser === undefined) {
    return <div className="auth-page"><div className="auth-panel"><div className="empty">Loading...</div></div></div>;
  }

  if (!currentUser) {
    return <AuthGate onAuthenticated={setCurrentUser} />;
  }

  return (
    <div className="layout">
      <ControlPanel
        chars={list}
        selection={selection}
        onRefresh={refresh}
        view={view}
        setView={setView}
        currentUser={currentUser}
        onLogout={onLogout}
        onSetMainCharacter={onSetMainCharacter}
      />

      {view === 'pilots' && (
        <main className="rows-wrap">
          <div className="rows-header" style={table.gridStyle}>
            <label className="col-select">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label="Select all" />
            </label>
            <div className="col-portrait" />
            {HEADERS.map(h => (
              <div key={h.col} className={`col-cell header-cell${h.align === 'right' ? ' right' : ''}`}>
                <button className="sort-btn" onClick={() => table.toggleSort(h.key)}>
                  <span className="label-text">{h.label}</span>
                  {totals[h.key] && <span className="total">{totals[h.key]}</span>}
                  {table.sortKey === h.key && <span className="arrow">{table.sortAsc ? '▲' : '▼'}</span>}
                </button>
                <div className="resizer" onMouseDown={e => table.startResize(h.col, e)} />
              </div>
            ))}
            <div className="col-actions">{selection.size}/{list.length}</div>
          </div>

          {loading && <div className="empty">Loading…</div>}
          {!loading && list.length === 0 && (
            <div className="empty">
              No characters yet. Click <b>Add character</b> in the sidebar to authenticate one via EVE SSO.
            </div>
          )}
          {list.map(c => (
            <CharacterCard
              key={c.characterId}
              c={c}
              bossFleetId={bossFleetId}
              selected={selection.has(c.characterId)}
              gridStyle={table.gridStyle}
              onToggle={onToggle}
              onRemove={onRemove}
              onSetBoss={onSetBoss}
            />
          ))}
        </main>
      )}

      {view === 'planets' && <PlanetsView chars={list} />}
      {view === 'skills' && <SkillsView chars={list} />}
      {view === 'fleet' && <FleetView chars={list} />}
      {view === 'market' && <MarketView chars={list} />}
      {view === 'industry' && <IndustryView chars={list} />}
      {view === 'contracts' && <ContractsView />}
      {view === 'fits' && <FitsView chars={list} currentUser={currentUser} />}
      {view === 'assets' && <AssetsView />}
    </div>
  );
}

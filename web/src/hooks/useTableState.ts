import { useCallback, useEffect, useState } from 'react';

export type SortKey = 'name' | 'location' | 'ship' | 'wallet' | 'training' | 'sp' | 'implants';

export type ColKey =
  | 'select' | 'portrait'
  | 'name' | 'location' | 'ship' | 'wallet' | 'training' | 'sp' | 'implants'
  | 'actions';

const DEFAULT_WIDTHS: Record<ColKey, number> = {
  select: 28,
  portrait: 40,
  name: 260,
  location: 160,
  ship: 200,
  wallet: 100,
  training: 200,
  sp: 110,
  implants: 90,
  actions: 140,
};

const MIN_WIDTH: Partial<Record<ColKey, number>> = {
  name: 140, location: 90, ship: 120, wallet: 70, training: 120, sp: 70, implants: 60,
};

const STORE_KEY = 'efd.table.v2';

interface Persisted {
  widths: Record<ColKey, number>;
  sortKey: SortKey;
  sortAsc: boolean;
}

function loadState(): Persisted {
  try {
    const s = localStorage.getItem(STORE_KEY);
    if (!s) throw 0;
    const parsed = JSON.parse(s) as Partial<Persisted>;
    return {
      widths: { ...DEFAULT_WIDTHS, ...(parsed.widths ?? {}) },
      sortKey: parsed.sortKey ?? 'name',
      sortAsc: parsed.sortAsc ?? true,
    };
  } catch {
    return { widths: DEFAULT_WIDTHS, sortKey: 'name', sortAsc: true };
  }
}

export function useTableState() {
  const [state, setState] = useState<Persisted>(loadState);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }, [state]);

  const setWidth = useCallback((key: ColKey, px: number) => {
    const min = MIN_WIDTH[key] ?? 40;
    setState(s => ({ ...s, widths: { ...s.widths, [key]: Math.max(min, px) } }));
  }, []);

  const toggleSort = useCallback((key: SortKey) => {
    setState(s => s.sortKey === key ? { ...s, sortAsc: !s.sortAsc } : { ...s, sortKey: key, sortAsc: true });
  }, []);

  // Emit column widths as CSS custom properties so a media query can still override
  // the full grid-template-columns when the viewport gets narrow.
  const gridStyle = Object.fromEntries(
    (Object.keys(state.widths) as ColKey[]).map(k => [`--col-${k}`, `${state.widths[k]}px`]),
  ) as React.CSSProperties;

  const startResize = (key: ColKey, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = state.widths[key];
    const onMove = (ev: MouseEvent) => setWidth(key, startWidth + (ev.clientX - startX));
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return { ...state, gridStyle, toggleSort, startResize };
}

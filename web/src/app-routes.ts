export type View = 'pilots' | 'planets' | 'skills' | 'fleet' | 'market' | 'industry' | 'contracts' | 'fits' | 'assets';

export type AppRoute =
  | { view: Exclude<View, 'fits'> }
  | { view: 'fits'; mode?: 'fits' | 'doctrines'; fitId?: number; doctrineId?: number };

const VIEW_PATHS: Record<View, string> = {
  pilots: '/pilots',
  fleet: '/fleet',
  fits: '/fits',
  assets: '/assets',
  market: '/market',
  contracts: '/contracts',
  industry: '/industry',
  planets: '/planets',
  skills: '/skills',
};

export function parseAppRoute(pathname: string): AppRoute {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return { view: 'pilots' };

  const [first, second] = parts;
  if (first === 'fit' && numericId(second) != null) return { view: 'fits', mode: 'fits', fitId: numericId(second)! };
  if (first === 'doctrine' && numericId(second) != null) return { view: 'fits', mode: 'doctrines', doctrineId: numericId(second)! };
  if (first === 'doctrines') return { view: 'fits', mode: 'doctrines' };
  if (first === 'contract') return { view: 'contracts' };

  if (isView(first)) return first === 'fits' ? { view: 'fits', mode: 'fits' } : { view: first };
  return { view: 'pilots' };
}

export function pathForRoute(route: AppRoute): string {
  if (route.view !== 'fits') return VIEW_PATHS[route.view];
  if (route.fitId != null) return `/fit/${route.fitId}`;
  if (route.doctrineId != null) return `/doctrine/${route.doctrineId}`;
  return route.mode === 'doctrines' ? '/doctrines' : '/fits';
}

export function routeForView(view: View): AppRoute {
  return view === 'fits' ? { view: 'fits', mode: 'fits' } : { view };
}

function isView(value: string): value is View {
  return Object.prototype.hasOwnProperty.call(VIEW_PATHS, value);
}

function numericId(value: string | undefined): number | null {
  if (value == null || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

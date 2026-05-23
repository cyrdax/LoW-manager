import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchPlexHistory,
  fetchPlexOrders,
  quoteShoppingList,
  sendShoppingList,
  type CharacterStatus,
  type PlexHistory,
  type PlexHistoryEntry,
  type PlexOrders,
  type ShoppingHub,
  type ShoppingListQuote,
} from '../api.ts';

interface Props { chars: CharacterStatus[] }

type Range = '7d' | '30d' | '90d' | '1y' | 'all';
const RANGES: Array<{ key: Range; label: string; days: number | null }> = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'ALL', days: null },
];

function formatIsk(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatPct(p: number): string {
  const sign = p >= 0 ? '+' : '';
  return `${sign}${p.toFixed(2)}%`;
}

function pctChange(from: number, to: number): number {
  if (from === 0) return 0;
  return ((to - from) / from) * 100;
}

type MarketTab = 'plex' | 'shopping';

export function MarketView({ chars }: Props) {
  const [tab, setTab] = useState<MarketTab>(
    () => (localStorage.getItem('efd.market.tab') as MarketTab) || 'plex',
  );
  useEffect(() => { localStorage.setItem('efd.market.tab', tab); }, [tab]);

  return (
    <main className="rows-wrap market-view">
      <div className="mk-tabs">
        <button
          className={`mk-tab${tab === 'plex' ? ' active' : ''}`}
          onClick={() => setTab('plex')}
        >PLEX</button>
        <button
          className={`mk-tab${tab === 'shopping' ? ' active' : ''}`}
          onClick={() => setTab('shopping')}
        >Shopping List</button>
      </div>
      {tab === 'plex' ? <PlexView /> : <ShoppingListView chars={chars} />}
    </main>
  );
}

function PlexView() {
  const [history, setHistory] = useState<PlexHistory | null>(null);
  const [orders, setOrders] = useState<PlexOrders | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>(() => (localStorage.getItem('efd.market.range') as Range) || '90d');

  useEffect(() => { localStorage.setItem('efd.market.range', range); }, [range]);

  const reload = async () => {
    setLoading(true);
    setError(null);
    const [h, o] = await Promise.all([fetchPlexHistory(), fetchPlexOrders()]);
    setLoading(false);
    if ('error' in h) { setError(h.error); setHistory(null); }
    else setHistory(h);
    if ('error' in o) setOrders(null);
    else setOrders(o);
  };

  useEffect(() => { reload(); }, []);

  // Auto-refresh orders every 5 minutes (history cache is 1h server-side).
  useEffect(() => {
    const t = setInterval(async () => {
      const o = await fetchPlexOrders();
      if (!('error' in o)) setOrders(o);
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const sliced = useMemo(() => sliceRange(history?.history ?? [], range), [history, range]);

  // Reference price for % change derives from the active range's first day.
  const refPrice = sliced.length > 0 ? sliced[0].average : null;
  const latest = history?.history?.[history.history.length - 1] ?? null;
  const change24h = history && history.history.length >= 2
    ? pctChange(history.history[history.history.length - 2].average, history.history[history.history.length - 1].average)
    : null;
  const changeRange = refPrice != null && latest != null ? pctChange(refPrice, latest.average) : null;

  return (
    <>
      <div className="mk-header">
        <div className="mk-title">
          <span className="mk-h1">PLEX</span>
          <span className="dim"> · {history?.regionName ?? 'Global PLEX Market'}</span>
        </div>
        <button className="fl-refresh" onClick={reload} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="mk-stats">
        <Stat label="Best sell (lowest ask)" value={formatIsk(orders?.bestSell ?? null)} good />
        <Stat label="Best buy (highest bid)" value={formatIsk(orders?.bestBuy ?? null)} />
        <Stat
          label="Spread"
          value={orders?.spread != null ? formatIsk(orders.spread) : '—'}
          sub={orders?.bestSell && orders?.bestBuy ? `${((orders.spread! / orders.bestBuy) * 100).toFixed(2)}%` : undefined}
        />
        <Stat
          label="Daily Δ"
          value={change24h != null ? formatPct(change24h) : '—'}
          cls={change24h != null ? (change24h >= 0 ? 'ok' : 'err') : ''}
        />
        <Stat
          label={`${range.toUpperCase()} Δ`}
          value={changeRange != null ? formatPct(changeRange) : '—'}
          cls={changeRange != null ? (changeRange >= 0 ? 'ok' : 'err') : ''}
        />
        <Stat
          label="Last day volume"
          value={latest ? latest.volume.toLocaleString() : '—'}
          sub={latest ? `${latest.order_count} orders` : undefined}
        />
      </div>

      <div className="mk-range">
        {RANGES.map(r => (
          <button
            key={r.key}
            className={`mk-range-btn${range === r.key ? ' active' : ''}`}
            onClick={() => setRange(r.key)}
          >{r.label}</button>
        ))}
      </div>

      {error && <div className="empty err">{error}</div>}
      {!error && !loading && sliced.length > 0 && <PriceChart data={sliced} />}
      {!error && !loading && sliced.length === 0 && <div className="empty">No data in this range.</div>}

      <SellCalculator orders={orders} />
    </>
  );
}

// --- Shopping List ---

interface ParsedLine { name: string; qty: number; raw: string; ok: boolean }

function parseShoppingList(text: string): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map(raw => {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      // Accept "<qty> <name>" or "<qty>x <name>" or tab-separated "<name>\t<qty>"
      // (the latter is how EVE's in-game inventory copy works).
      let m = trimmed.match(/^(\d[\d,]*)\s*[x×]?\s+(.+)$/i);
      if (m) {
        const qty = Number(m[1].replace(/,/g, ''));
        return { name: m[2].trim(), qty, raw: trimmed, ok: qty > 0 };
      }
      m = trimmed.match(/^(.+?)\t+(\d[\d,]*)\b/);
      if (m) {
        const qty = Number(m[2].replace(/,/g, ''));
        return { name: m[1].trim(), qty, raw: trimmed, ok: qty > 0 };
      }
      return { name: trimmed, qty: 0, raw: trimmed, ok: false };
    })
    .filter((x): x is ParsedLine => x !== null);
}

const SHOPPING_TEXT_KEY = 'efd.market.shopping.text';
const SHOPPING_HUB_KEY = 'efd.market.shopping.hub';
const SHOPPING_PILOT_KEY = 'efd.market.shopping.pilot';

type SendStatus =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; pilotName: string; mailId: number | null }
  | { kind: 'error'; message: string; reauthHint: string | null };

function ShoppingListView({ chars }: { chars: CharacterStatus[] }) {
  const [hub, setHub] = useState<ShoppingHub>(
    () => (localStorage.getItem(SHOPPING_HUB_KEY) as ShoppingHub) || 'jita',
  );
  const [text, setText] = useState<string>(() => localStorage.getItem(SHOPPING_TEXT_KEY) ?? '');
  const [quote, setQuote] = useState<ShoppingListQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Pilot dropdown defaults to the previously-used selection if still present,
  // otherwise to the first authed pilot. Stored as a string in localStorage
  // because <select> values are strings.
  const sortedChars = useMemo(
    () => [...chars].sort((a, b) => a.name.localeCompare(b.name)),
    [chars],
  );
  const [pilotId, setPilotId] = useState<number | null>(() => {
    const raw = localStorage.getItem(SHOPPING_PILOT_KEY);
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  useEffect(() => {
    if (sortedChars.length === 0) return;
    if (pilotId == null || !sortedChars.some(c => c.characterId === pilotId)) {
      setPilotId(sortedChars[0].characterId);
    }
  }, [sortedChars, pilotId]);
  useEffect(() => {
    if (pilotId != null) localStorage.setItem(SHOPPING_PILOT_KEY, String(pilotId));
  }, [pilotId]);

  const [sendStatus, setSendStatus] = useState<SendStatus>({ kind: 'idle' });

  useEffect(() => { localStorage.setItem(SHOPPING_HUB_KEY, hub); }, [hub]);
  useEffect(() => { localStorage.setItem(SHOPPING_TEXT_KEY, text); }, [text]);

  const parsed = useMemo(() => parseShoppingList(text), [text]);
  const validItems = useMemo(() => parsed.filter(p => p.ok), [parsed]);
  const parseErrors = useMemo(() => parsed.filter(p => !p.ok), [parsed]);

  const calculate = async () => {
    if (validItems.length === 0) {
      setError('No valid lines. Format: "<qty> <item name>" per line.');
      return;
    }
    setLoading(true);
    setError(null);
    setSendStatus({ kind: 'idle' });
    const res = await quoteShoppingList(hub, validItems.map(p => ({ name: p.name, qty: p.qty })));
    setLoading(false);
    if ('error' in res) {
      setQuote(null);
      setError(res.error);
    } else {
      setQuote(res);
    }
  };

  const sendToPilot = async () => {
    if (!quote || pilotId == null) return;
    const pilot = sortedChars.find(c => c.characterId === pilotId);
    if (!pilot) return;
    setSendStatus({ kind: 'sending' });
    // Resend the validated items rather than the quote rows so the server
    // walks the book at send-time (prices may have shifted between Calculate
    // and Send).
    const res = await sendShoppingList(
      hub,
      validItems.map(p => ({ name: p.name, qty: p.qty })),
      pilotId,
    );
    if ('error' in res) {
      setSendStatus({ kind: 'error', message: res.error, reauthHint: res.reauthHint ?? null });
    } else {
      setSendStatus({ kind: 'sent', pilotName: pilot.name, mailId: res.mailId });
    }
  };

  return (
    <>
      <div className="mk-header">
        <div className="mk-title">
          <span className="mk-h1">Shopping List</span>
          <span className="dim"> · in-system sell orders, cheapest first</span>
        </div>
      </div>

      <div className="mk-shop-controls">
        <div className="mk-shop-hubs">
          {(['jita', 'amarr'] as const).map(h => (
            <button
              key={h}
              className={`mk-tab${hub === h ? ' active' : ''}`}
              onClick={() => setHub(h)}
            >{h === 'jita' ? 'Jita' : 'Amarr'}</button>
          ))}
        </div>
        <div className="mk-shop-summary dim">
          {parsed.length === 0
            ? 'Paste your list below'
            : `${validItems.length} item${validItems.length === 1 ? '' : 's'}` +
              (parseErrors.length > 0 ? `, ${parseErrors.length} unparsed line${parseErrors.length === 1 ? '' : 's'}` : '')}
        </div>
        <button
          className="fl-refresh"
          onClick={calculate}
          disabled={loading || validItems.length === 0}
        >{loading ? 'Pricing…' : 'Calculate'}</button>
      </div>

      <textarea
        className="mk-shop-input"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={'2 Cap Recharger II\n4 Multispectrum Energized Membrane II\n1 Nanofiber Internal Structure II'}
        spellCheck={false}
        rows={10}
      />

      {parseErrors.length > 0 && (
        <div className="mk-shop-warn dim">
          Couldn't parse: {parseErrors.slice(0, 3).map(p => `"${p.raw}"`).join(', ')}
          {parseErrors.length > 3 ? ` and ${parseErrors.length - 3} more` : ''}
        </div>
      )}

      {error && <div className="empty err">{error}</div>}

      {quote && (
        <>
          <div className="mk-shop-send">
            <label className="mk-shop-send-label" htmlFor="mk-shop-pilot">Send to pilot</label>
            <select
              id="mk-shop-pilot"
              className="mk-shop-pilot-select"
              value={pilotId ?? ''}
              onChange={e => setPilotId(Number(e.target.value) || null)}
              disabled={sortedChars.length === 0 || sendStatus.kind === 'sending'}
            >
              {sortedChars.length === 0 && <option value="">No pilots authed</option>}
              {sortedChars.map(c => (
                <option key={c.characterId} value={c.characterId}>
                  {c.name}{c.needsReauth ? ' (needs re-auth)' : ''}
                </option>
              ))}
            </select>
            <button
              className="fl-refresh"
              onClick={sendToPilot}
              disabled={pilotId == null || sendStatus.kind === 'sending'}
              title="Sends the list as an EVEmail to the selected pilot, with each item as a clickable in-game link"
            >{sendStatus.kind === 'sending' ? 'Sending…' : 'Send as EVEmail'}</button>
            {sendStatus.kind === 'sent' && (
              <span className="mk-shop-send-ok">
                Sent to {sendStatus.pilotName}{sendStatus.mailId != null ? ` (mail #${sendStatus.mailId})` : ''}. Check their in-game mail tab.
              </span>
            )}
            {sendStatus.kind === 'error' && (
              <span className="mk-shop-send-err">
                {sendStatus.message}
                {sendStatus.reauthHint && (
                  <> · <span className="dim">{sendStatus.reauthHint}</span></>
                )}
              </span>
            )}
          </div>
          <ShoppingListResults quote={quote} />
        </>
      )}
    </>
  );
}

function ShoppingListResults({ quote }: { quote: ShoppingListQuote }) {
  return (
    <div className="mk-shop-results">
      <div className="mk-shop-totals">
        <Stat label={`Total (in ${quote.systemName})`} value={`${formatIsk(quote.totalCost)} ISK`} good />
        <Stat label="Full" value={String(quote.counts.ok)} />
        <Stat
          label="Partial"
          value={String(quote.counts.partial)}
          cls={quote.counts.partial > 0 ? 'err' : ''}
        />
        <Stat
          label="No sellers"
          value={String(quote.counts.noOrders)}
          cls={quote.counts.noOrders > 0 ? 'err' : ''}
        />
        <Stat
          label="Unknown"
          value={String(quote.counts.unknown)}
          cls={quote.counts.unknown > 0 ? 'err' : ''}
        />
      </div>

      <table className="mk-shop-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Filled</th>
            <th className="num">Avg price</th>
            <th className="num">Subtotal</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {quote.items.map((it, i) => (
            <tr key={i} className={`mk-shop-row mk-shop-${it.status}`}>
              <td>{it.resolvedName ?? it.inputName}</td>
              <td className="num">{it.requestedQty.toLocaleString()}</td>
              <td className="num">
                {it.filledQty.toLocaleString()}
                {it.shortfall > 0 && it.status !== 'unknown-item' && (
                  <span className="dim"> (−{it.shortfall.toLocaleString()})</span>
                )}
              </td>
              <td className="num">{it.avgPrice != null ? `${formatIsk(it.avgPrice)} ISK` : '—'}</td>
              <td className="num">{it.totalCost > 0 ? `${formatIsk(it.totalCost)} ISK` : '—'}</td>
              <td>
                {it.status === 'ok' && <span className="mk-shop-pill ok">ok</span>}
                {it.status === 'partial' && <span className="mk-shop-pill warn">partial fill</span>}
                {it.status === 'no-orders' && <span className="mk-shop-pill err">no sellers</span>}
                {it.status === 'unknown-item' && <span className="mk-shop-pill err">unknown item</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="mk-shop-foot-label">Grand total ({quote.systemName}, {quote.regionName})</td>
            <td className="num mk-shop-foot-val">{formatIsk(quote.totalCost)} ISK</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Stat({ label, value, sub, cls, good }: {
  label: string;
  value: string;
  sub?: string;
  cls?: string;
  good?: boolean;
}) {
  return (
    <div className="mk-stat">
      <div className="mk-stat-label">{label}</div>
      <div className={`mk-stat-value${cls ? ` ${cls}` : ''}${good ? ' ok' : ''}`}>{value}</div>
      {sub && <div className="mk-stat-sub dim">{sub}</div>}
    </div>
  );
}

function sliceRange(history: PlexHistoryEntry[], range: Range): PlexHistoryEntry[] {
  const r = RANGES.find(x => x.key === range);
  if (!r || r.days == null) return history;
  return history.slice(-r.days);
}

// --- Chart ---

interface ChartPoint {
  x: number;        // pixel x
  y: number;        // pixel y (for average)
  yHigh: number;
  yLow: number;
  d: PlexHistoryEntry;
}

const CHART = {
  height: 360,
  paddingTop: 20,
  paddingBottom: 32,
  paddingLeft: 64,
  paddingRight: 16,
  volumeHeight: 56,
  volumeGap: 8,
};

function PriceChart({ data }: { data: PlexHistoryEntry[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const update = () => {
      const w = wrapRef.current?.clientWidth ?? 800;
      setWidth(Math.max(320, w));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const innerW = width - CHART.paddingLeft - CHART.paddingRight;
  const priceH = CHART.height - CHART.paddingTop - CHART.paddingBottom - CHART.volumeHeight - CHART.volumeGap;

  const { minP, maxP, maxVol } = useMemo(() => {
    let minP = Infinity, maxP = -Infinity, maxVol = 0;
    for (const d of data) {
      if (d.lowest < minP) minP = d.lowest;
      if (d.highest > maxP) maxP = d.highest;
      if (d.volume > maxVol) maxVol = d.volume;
    }
    // Add ~5% padding so the line doesn't touch the edges.
    const pad = (maxP - minP) * 0.05 || maxP * 0.01;
    return { minP: Math.max(0, minP - pad), maxP: maxP + pad, maxVol };
  }, [data]);

  const points = useMemo<ChartPoint[]>(() => {
    if (data.length === 0) return [];
    const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
    const yScale = (v: number) => CHART.paddingTop + priceH - ((v - minP) / (maxP - minP || 1)) * priceH;
    return data.map((d, i) => ({
      x: CHART.paddingLeft + i * stepX,
      y: yScale(d.average),
      yHigh: yScale(d.highest),
      yLow: yScale(d.lowest),
      d,
    }));
  }, [data, innerW, priceH, minP, maxP]);

  const linePath = useMemo(() => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), [points]);
  const bandPath = useMemo(() => {
    if (points.length === 0) return '';
    const top = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.yHigh.toFixed(1)}`).join(' ');
    const bottom = points.slice().reverse().map(p => `L${p.x.toFixed(1)},${p.yLow.toFixed(1)}`).join(' ');
    return `${top} ${bottom} Z`;
  }, [points]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    // Map to nearest data index.
    if (points.length === 0) return;
    const relX = px - CHART.paddingLeft;
    const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
    let idx = stepX > 0 ? Math.round(relX / stepX) : 0;
    idx = Math.max(0, Math.min(points.length - 1, idx));
    setHoverIdx(idx);
  };

  const onLeave = () => setHoverIdx(null);

  // 5 horizontal grid lines.
  const yTicks = useMemo(() => {
    const ticks: Array<{ y: number; v: number }> = [];
    for (let i = 0; i <= 4; i++) {
      const v = minP + ((maxP - minP) * i) / 4;
      const y = CHART.paddingTop + priceH - ((v - minP) / (maxP - minP || 1)) * priceH;
      ticks.push({ y, v });
    }
    return ticks;
  }, [minP, maxP, priceH]);

  // X-axis labels: ~6 evenly spaced dates.
  const xTicks = useMemo(() => {
    if (points.length === 0) return [];
    const target = 6;
    const step = Math.max(1, Math.floor(points.length / target));
    const out: Array<{ x: number; label: string }> = [];
    for (let i = 0; i < points.length; i += step) {
      out.push({ x: points[i].x, label: shortDate(points[i].d.date) });
    }
    // Always include the last point.
    const last = points[points.length - 1];
    if (out.length === 0 || out[out.length - 1].x !== last.x) {
      out.push({ x: last.x, label: shortDate(last.d.date) });
    }
    return out;
  }, [points]);

  const volBaselineY = CHART.paddingTop + priceH + CHART.volumeGap + CHART.volumeHeight;
  const volBarWidth = points.length > 1 ? Math.max(1, (innerW / (points.length - 1)) * 0.7) : 4;

  const hover = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div className="mk-chart-wrap" ref={wrapRef}>
      <svg
        className="mk-chart"
        width={width}
        height={CHART.height}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        {/* Y-axis gridlines + price labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              className="mk-grid"
              x1={CHART.paddingLeft}
              x2={width - CHART.paddingRight}
              y1={t.y}
              y2={t.y}
            />
            <text className="mk-axis-text" x={CHART.paddingLeft - 6} y={t.y + 3} textAnchor="end">
              {formatIsk(t.v)}
            </text>
          </g>
        ))}

        {/* High-low band */}
        {bandPath && <path className="mk-band" d={bandPath} />}

        {/* Average line */}
        <path className="mk-line" d={linePath} />

        {/* Volume bars */}
        {points.map(p => {
          const h = maxVol > 0 ? (p.d.volume / maxVol) * CHART.volumeHeight : 0;
          return (
            <rect
              key={p.d.date}
              className="mk-volbar"
              x={p.x - volBarWidth / 2}
              y={volBaselineY - h}
              width={volBarWidth}
              height={h}
            />
          );
        })}
        <line
          className="mk-axis-line"
          x1={CHART.paddingLeft}
          x2={width - CHART.paddingRight}
          y1={volBaselineY}
          y2={volBaselineY}
        />

        {/* X-axis labels */}
        {xTicks.map((t, i) => (
          <text key={i} className="mk-axis-text" x={t.x} y={CHART.height - 8} textAnchor="middle">
            {t.label}
          </text>
        ))}

        {/* Hover crosshair */}
        {hover && (
          <>
            <line
              className="mk-crosshair"
              x1={hover.x}
              x2={hover.x}
              y1={CHART.paddingTop}
              y2={volBaselineY}
            />
            <circle className="mk-dot" cx={hover.x} cy={hover.y} r={4} />
          </>
        )}
      </svg>

      {hover && (
        <div
          className="mk-tooltip"
          style={{
            left: Math.min(width - 200, Math.max(8, hover.x + 12)),
            top: 16,
          }}
        >
          <div className="mk-tt-date">{hover.d.date}</div>
          <div className="mk-tt-row"><span>Avg</span><b>{formatIsk(hover.d.average)}</b></div>
          <div className="mk-tt-row"><span>High</span><b>{formatIsk(hover.d.highest)}</b></div>
          <div className="mk-tt-row"><span>Low</span><b>{formatIsk(hover.d.lowest)}</b></div>
          <div className="mk-tt-row dim"><span>Vol</span><span>{hover.d.volume.toLocaleString()}</span></div>
          <div className="mk-tt-row dim"><span>Orders</span><span>{hover.d.order_count}</span></div>
        </div>
      )}
    </div>
  );
}

// --- Sell calculator ---
//
// EVE market fee formulas (current as of Equinox era, late 2024+):
//   Sales tax     = 8% × (1 - 0.11 × Accounting level)         → 3.6% at V
//   Broker's fee  = 3% - 0.3% × Broker Relations level         → 1.5% at V
// Station faction standing can further reduce broker's fee; not modelled here
// since multibox users typically run with grind-able skills, not grind-able
// standings. The fee % field is editable so you can match a citadel's tariff.

interface CalcState {
  solveFor: 'qty' | 'target';
  quantity: string;
  target: string;            // target net ISK, used when solveFor === 'target'
  mode: 'instant' | 'list';
  accounting: number;        // 0–5
  brokerRelations: number;   // 0–5
  customPriceMode: 'auto' | 'manual';
  manualPrice: string;       // ISK per PLEX, only when customPriceMode === 'manual'
}

const CALC_STORE_KEY = 'efd.market.calc';

function loadCalcState(): CalcState {
  try {
    const raw = localStorage.getItem(CALC_STORE_KEY);
    if (!raw) throw 0;
    const p = JSON.parse(raw) as Partial<CalcState>;
    return {
      solveFor: p.solveFor ?? 'qty',
      quantity: p.quantity ?? '1',
      target: p.target ?? '',
      mode: p.mode ?? 'instant',
      accounting: clamp(p.accounting ?? 5, 0, 5),
      brokerRelations: clamp(p.brokerRelations ?? 5, 0, 5),
      customPriceMode: p.customPriceMode ?? 'auto',
      manualPrice: p.manualPrice ?? '',
    };
  } catch {
    return {
      solveFor: 'qty',
      quantity: '1',
      target: '',
      mode: 'instant',
      accounting: 5,
      brokerRelations: 5,
      customPriceMode: 'auto',
      manualPrice: '',
    };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function salesTaxRate(accounting: number): number {
  return 0.08 * (1 - 0.11 * accounting);
}

function brokerFeeRate(brokerRelations: number): number {
  return 0.03 - 0.003 * brokerRelations;
}

function SellCalculator({ orders }: { orders: PlexOrders | null }) {
  const [s, setS] = useState<CalcState>(loadCalcState);
  useEffect(() => { localStorage.setItem(CALC_STORE_KEY, JSON.stringify(s)); }, [s]);

  const taxRate = salesTaxRate(s.accounting);
  const brokerRate = s.mode === 'list' ? brokerFeeRate(s.brokerRelations) : 0;
  // Fraction of gross you keep after fees. Used in target-ISK mode to invert
  // the math: qty = ceil(targetNet / (price × keepRate)).
  const keepRate = 1 - taxRate - brokerRate;

  // Auto price: instant = best buy (you sell into it); list = best sell (you'd at least match it).
  const autoPrice = s.mode === 'instant'
    ? (orders?.bestBuy ?? null)
    : (orders?.bestSell ?? null);
  const price = s.customPriceMode === 'manual'
    ? (Number(s.manualPrice) || 0)
    : (autoPrice ?? 0);

  const targetIsk = Math.max(0, Number(s.target) || 0);
  const qty = s.solveFor === 'target'
    ? (price > 0 && keepRate > 0 ? Math.ceil(targetIsk / (price * keepRate)) : 0)
    : Math.max(0, Number(s.quantity) || 0);

  const gross = qty * price;
  const brokerFee = gross * brokerRate;
  const salesTax = gross * taxRate;
  const net = gross - brokerFee - salesTax;
  const perPlexAfter = qty > 0 ? net / qty : 0;
  const overshoot = s.solveFor === 'target' ? Math.max(0, net - targetIsk) : 0;

  return (
    <div className="mk-calc">
      <div className="mk-calc-h">Sell calculator</div>

      <div className="mk-calc-solve">
        <span className="mk-calc-solve-label">Solve for</span>
        <div className="mk-calc-mode">
          <button
            className={s.solveFor === 'qty' ? 'active' : ''}
            onClick={() => setS({ ...s, solveFor: 'qty' })}
            title="Enter PLEX quantity, get net ISK"
          >Quantity → ISK</button>
          <button
            className={s.solveFor === 'target' ? 'active' : ''}
            onClick={() => setS({ ...s, solveFor: 'target' })}
            title="Enter target net ISK, get how many PLEX to sell"
          >Target ISK → PLEX</button>
        </div>
      </div>

      <div className="mk-calc-grid">
        {s.solveFor === 'qty' ? (
          <div className="mk-calc-field">
            <label>Quantity (PLEX)</label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={s.quantity}
              onChange={e => setS({ ...s, quantity: e.target.value })}
            />
          </div>
        ) : (
          <div className="mk-calc-field">
            <label>Target net ISK</label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={s.target}
              placeholder="e.g. 2000000000"
              onChange={e => setS({ ...s, target: e.target.value })}
            />
            <span className="mk-calc-derived">
              {targetIsk > 0 ? formatIsk(targetIsk) + ' ISK target' : 'enter a target'}
            </span>
          </div>
        )}

        <div className="mk-calc-field">
          <label>Sell mode</label>
          <div className="mk-calc-mode">
            <button
              className={s.mode === 'instant' ? 'active' : ''}
              onClick={() => setS({ ...s, mode: 'instant' })}
              title="Sell into the highest buy order — no broker fee, instant ISK"
            >Instant (to buy order)</button>
            <button
              className={s.mode === 'list' ? 'active' : ''}
              onClick={() => setS({ ...s, mode: 'list' })}
              title="Place a sell order at the ask — broker fee up front, sales tax on fill"
            >List (sell order)</button>
          </div>
        </div>

        <div className="mk-calc-field">
          <label>Accounting</label>
          <select
            value={s.accounting}
            onChange={e => setS({ ...s, accounting: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>Level {n}</option>)}
          </select>
          <span className="mk-calc-derived">sales tax {(taxRate * 100).toFixed(2)}%</span>
        </div>

        <div className="mk-calc-field">
          <label>Broker Relations</label>
          <select
            value={s.brokerRelations}
            onChange={e => setS({ ...s, brokerRelations: Number(e.target.value) })}
            disabled={s.mode === 'instant'}
          >
            {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>Level {n}</option>)}
          </select>
          <span className="mk-calc-derived">
            {s.mode === 'instant' ? 'n/a (no broker fee)' : `broker fee ${(brokerRate * 100).toFixed(2)}%`}
          </span>
        </div>

        <div className="mk-calc-field mk-calc-price">
          <label>Price per PLEX</label>
          <div className="mk-calc-price-row">
            <select
              value={s.customPriceMode}
              onChange={e => setS({ ...s, customPriceMode: e.target.value as 'auto' | 'manual' })}
            >
              <option value="auto">
                {s.mode === 'instant' ? 'Best buy (auto)' : 'Best sell (auto)'}
              </option>
              <option value="manual">Manual</option>
            </select>
            {s.customPriceMode === 'manual' ? (
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={s.manualPrice}
                placeholder="ISK"
                onChange={e => setS({ ...s, manualPrice: e.target.value })}
              />
            ) : (
              <span className="mk-calc-autoprice">{formatIsk(autoPrice)} ISK</span>
            )}
          </div>
        </div>
      </div>

      <div className="mk-calc-out">
        {s.solveFor === 'target' && (
          <Line
            label="PLEX to sell"
            value={qty}
            unit="PLEX"
            cls="ok"
            big
            sub={qty > 0
              ? `at ${formatIsk(price)} ISK/PLEX, fees ${((1 - keepRate) * 100).toFixed(2)}%`
              : (targetIsk === 0 ? 'enter a target above' : 'price unavailable')}
          />
        )}
        <Line label="Gross" value={gross} sub={`${qty.toLocaleString()} × ${formatIsk(price)} ISK`} />
        {s.mode === 'list' && (
          <Line label="Broker's fee" value={-brokerFee} sub={`${(brokerRate * 100).toFixed(2)}% up front`} cls="err" />
        )}
        <Line label="Sales tax" value={-salesTax} sub={`${(taxRate * 100).toFixed(2)}%`} cls="err" />
        <Line
          label="Net ISK"
          value={net}
          cls="ok"
          big={s.solveFor === 'qty'}
          sub={s.solveFor === 'target' && overshoot > 0
            ? `target +${formatIsk(overshoot)} ISK (integer-PLEX rounding)`
            : undefined}
        />
        <Line
          label="Effective per PLEX"
          value={perPlexAfter}
          sub={price > 0 ? `${((perPlexAfter / price) * 100).toFixed(2)}% of list` : undefined}
        />
      </div>

      {orders == null && (
        <div className="mk-calc-warn dim">Live order data hasn't loaded yet — auto price will fill in once orders return.</div>
      )}
    </div>
  );
}

function Line({ label, value, sub, cls, big, unit = 'ISK' }: {
  label: string;
  value: number;
  sub?: string;
  cls?: string;
  big?: boolean;
  unit?: string;
}) {
  return (
    <div className={`mk-calc-line${big ? ' big' : ''}`}>
      <div className="mk-calc-line-label">{label}</div>
      <div className={`mk-calc-line-val${cls ? ` ${cls}` : ''}`}>
        {value < 0 ? '−' : ''}{value === 0 ? '0' : Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} {unit}
      </div>
      {sub && <div className="mk-calc-line-sub dim">{sub}</div>}
    </div>
  );
}

function shortDate(iso: string): string {
  // YYYY-MM-DD → "MMM DD"
  const [_y, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mi = parseInt(m, 10) - 1;
  if (mi < 0 || mi > 11) return iso;
  return `${months[mi]} ${parseInt(d, 10)}`;
}

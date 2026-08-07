import type { CharacterStatus } from '../api.ts';
import { useRef, useState } from 'react';

interface Props {
  c: CharacterStatus;
  bossFleetId: number | null;
  selected: boolean;
  gridStyle: React.CSSProperties;
  onToggle: (id: number) => void;
  onRemove: (id: number) => void;
  onSetBoss: (id: number) => void;
}

function formatIsk(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatSp(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
}

function timeUntil(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'done';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function levelRoman(n: number | null): string {
  return ['', 'I', 'II', 'III', 'IV', 'V'][n ?? 0] ?? '';
}

function cloneStateLabel(state: CharacterStatus['cloneState']): string {
  switch (state) {
    case 'alpha-likely':
      return 'Alpha?';
    case 'omega-likely':
      return 'Omega?';
    case 'missing-skill-scope':
      return 'Skill scope';
    default:
      return 'Unknown';
  }
}

export interface CharacterRowVisualState {
  needsReauth: boolean;
  isBoss: boolean;
  hasVirtue: boolean;
  hasWrongImplants: boolean;
  queueShort: boolean;
  inBossFleet: boolean;
  missingFromBossFleet: boolean;
}

export interface CharacterRowStatusItem {
  label: string;
  detail: string;
}

const PILOT_TOOLTIP_WIDTH = 420;
const PILOT_TOOLTIP_HEIGHT = 160;
const PILOT_TOOLTIP_OFFSET = 12;
const PILOT_TOOLTIP_VIEWPORT_PAD = 12;

export function pilotRowTooltipPosition(
  pointer: { x: number; y: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const maxLeft = Math.max(PILOT_TOOLTIP_VIEWPORT_PAD, viewport.width - PILOT_TOOLTIP_WIDTH - PILOT_TOOLTIP_OFFSET);
  const maxTop = Math.max(PILOT_TOOLTIP_VIEWPORT_PAD, viewport.height - PILOT_TOOLTIP_HEIGHT - PILOT_TOOLTIP_OFFSET);
  return {
    left: Math.max(PILOT_TOOLTIP_VIEWPORT_PAD, Math.min(pointer.x + PILOT_TOOLTIP_OFFSET, maxLeft)),
    top: Math.max(PILOT_TOOLTIP_VIEWPORT_PAD, Math.min(pointer.y + PILOT_TOOLTIP_OFFSET, maxTop)),
  };
}

export function characterRowVisualState(c: CharacterStatus, bossFleetId: number | null, nowMs = Date.now()): CharacterRowVisualState {
  const inBossFleet = !c.isBoss && bossFleetId != null && c.fleetId === bossFleetId;
  const missingFromBossFleet = !c.isBoss && bossFleetId != null && c.fleetId !== bossFleetId;
  const relevantImplants = c.implantNames.filter(n => !/AU-?79/i.test(n));
  const hasImplants = relevantImplants.length > 0;
  const hasVirtue = relevantImplants.some(n => /virtue/i.test(n));
  const hasWrongImplants = hasImplants && !hasVirtue;
  const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
  const queueShort = c.trainingQueueEnd === '' || (
    typeof c.trainingQueueEnd === 'string'
    && c.trainingQueueEnd.length > 0
    && Date.parse(c.trainingQueueEnd) - nowMs < TEN_DAYS_MS
  );

  return {
    needsReauth: c.needsReauth,
    isBoss: c.isBoss,
    hasVirtue,
    hasWrongImplants,
    queueShort,
    inBossFleet,
    missingFromBossFleet,
  };
}

export function characterRowStatusItems(state: CharacterRowVisualState): CharacterRowStatusItem[] {
  return [
    state.isBoss ? { label: 'Blue row', detail: 'Fleet boss selected for fleet actions.' } : null,
    state.hasVirtue ? { label: 'Green row', detail: 'Virtue pod detected.' } : null,
    state.hasWrongImplants ? { label: 'Brown row', detail: 'Pilot has a non-Virtue implant pod. AU-79 is ignored.' } : null,
    state.needsReauth ? { label: 'Red border', detail: 'Pilot needs re-auth before private ESI data can refresh.' } : null,
    state.queueShort ? { label: 'Red outline', detail: 'Skill queue ends in under 10 days or is empty.' } : null,
    state.inBossFleet ? { label: 'Green check', detail: 'Pilot is in the boss fleet.' } : null,
    state.missingFromBossFleet ? { label: 'Amber X', detail: 'Pilot is not in the boss fleet.' } : null,
  ].filter((item): item is CharacterRowStatusItem => item != null);
}

export function characterRowTooltipText(state: CharacterRowVisualState): string {
  const items = characterRowStatusItems(state);
  if (items.length === 0) return 'No special row status.';
  return items.map(item => `${item.label}: ${item.detail}`).join('\n');
}

export function CharacterCard({ c, bossFleetId, selected, gridStyle, onToggle, onRemove, onSetBoss }: Props) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dotClass = c.online === null ? 'dot unknown' : c.online ? 'dot online' : 'dot';
  const location = c.locationStationName ?? c.locationSystemName ?? '—';
  const ship = c.shipTypeName ? `${c.shipTypeName}${c.shipName ? ` · ${c.shipName}` : ''}` : '—';
  const training = c.trainingSkillName
    ? `${c.trainingSkillName} ${levelRoman(c.trainingLevel)} · ${timeUntil(c.trainingFinishDate)}`
    : 'Not training';
  const corpLabel = c.corporationTicker ? `[${c.corporationTicker}]` : '';
  const implantsTitle = c.implantNames.length ? c.implantNames.join('\n') : 'No implants';
  const visualState = characterRowVisualState(c, bossFleetId);
  const statusItems = characterRowStatusItems(visualState);
  const tooltipId = `pilot-row-status-${c.characterId}`;

  const rowClass = [
    'prow',
    visualState.needsReauth && 'needs-reauth',
    visualState.isBoss && 'is-boss',
    visualState.hasVirtue && 'has-virtue',
    visualState.hasWrongImplants && 'has-wrong-implants',
    visualState.queueShort && 'queue-short',
  ].filter(Boolean).join(' ');

  const positionTooltip = (clientX: number, clientY: number) => {
    setTooltipPosition(pilotRowTooltipPosition(
      { x: clientX, y: clientY },
      { width: window.innerWidth, height: window.innerHeight },
    ));
  };
  const openTooltipSoon = (clientX: number, clientY: number) => {
    positionTooltip(clientX, clientY);
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => setTooltipOpen(true), 450);
  };
  const moveTooltip = (event: React.MouseEvent<HTMLDivElement>) => {
    if (tooltipOpen) positionTooltip(event.clientX, event.clientY);
  };
  const focusTooltip = (event: React.FocusEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openTooltipSoon(rect.left + 64, rect.top + 18);
  };
  const closeTooltip = () => {
    if (tooltipTimer.current) {
      clearTimeout(tooltipTimer.current);
      tooltipTimer.current = null;
    }
    setTooltipOpen(false);
    setTooltipPosition(null);
  };

  return (
    <div
      className={rowClass}
      style={gridStyle}
      onMouseEnter={event => openTooltipSoon(event.clientX, event.clientY)}
      onMouseMove={moveTooltip}
      onMouseLeave={closeTooltip}
      onFocus={focusTooltip}
      onBlur={closeTooltip}
      aria-describedby={tooltipOpen && statusItems.length > 0 ? tooltipId : undefined}
    >
      <label className="col-select">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(c.characterId)}
          aria-label={`Select ${c.name}`}
        />
      </label>

      <img className="col-portrait" src={c.portraitUrl} alt="" width={40} height={40} />

      <div className="col-name">
        <div className="title">
          <span className={dotClass} />
          <span className="character">{c.name || `#${c.characterId}`}</span>
          <span className={`clone-state ${c.cloneState}`} title={c.cloneStateReason}>
            {cloneStateLabel(c.cloneState)}
          </span>
          {c.isBoss && <span className="boss">BOSS</span>}
          {visualState.inBossFleet && <span className="pill ok">✓</span>}
          {visualState.missingFromBossFleet && <span className="pill warn">×</span>}
        </div>
        <div className="corp" title={c.corporationName ?? undefined}>{corpLabel} {c.corporationName ?? ''}</div>
      </div>

      <div className="col-cell">
        <div className="label">Location</div>
        <div className="value">{location}</div>
      </div>

      <div className="col-cell">
        <div className="label">Ship</div>
        <div className="value" title={ship}>{ship}</div>
      </div>

      <div className="col-cell right">
        <div className="label">Wallet</div>
        <div className="value">{formatIsk(c.walletBalance)}</div>
      </div>

      <div className="col-cell">
        <div className="label">Training</div>
        <div className="value dim" title={training}>{training}</div>
      </div>

      <div className="col-cell right">
        <div className="label">SP</div>
        <div className="value">{formatSp(c.totalSp)}</div>
      </div>

      <div className="col-cell right">
        <div className="label">Free</div>
        <div className="value">
          {c.unallocatedSp != null && c.unallocatedSp > 0
            ? <span className="free">{formatSp(c.unallocatedSp)}</span>
            : <span className="dim">—</span>}
        </div>
      </div>

      <div className="col-cell right">
        <div className="label">Implants</div>
        <div className="value" title={implantsTitle}>{c.implantNames.length}/10</div>
      </div>

      <div className="col-actions">
        {!c.isBoss && (
          <button onClick={() => onSetBoss(c.characterId)} title="Set as fleet boss">★</button>
        )}
        <button className="danger" onClick={() => onRemove(c.characterId)} title="Remove">×</button>
      </div>

      {c.needsReauth && <div className="reauth-line">Needs re-auth</div>}
      {tooltipOpen && tooltipPosition && statusItems.length > 0 && (
        <div className="pilot-row-tooltip" id={tooltipId} role="tooltip" style={tooltipPosition}>
          <div className="pilot-row-tooltip-title">Row status</div>
          {statusItems.map(item => (
            <div className="pilot-row-tooltip-line" key={item.label}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

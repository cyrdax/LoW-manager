import type { CharacterStatus } from '../api.ts';

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

export function CharacterCard({ c, bossFleetId, selected, gridStyle, onToggle, onRemove, onSetBoss }: Props) {
  const dotClass = c.online === null ? 'dot unknown' : c.online ? 'dot online' : 'dot';
  const location = c.locationStationName ?? c.locationSystemName ?? '—';
  const ship = c.shipTypeName ? `${c.shipTypeName}${c.shipName ? ` · ${c.shipName}` : ''}` : '—';
  const training = c.trainingSkillName
    ? `${c.trainingSkillName} ${levelRoman(c.trainingLevel)} · ${timeUntil(c.trainingFinishDate)}`
    : 'Not training';
  const inBossFleet = !c.isBoss && bossFleetId != null && c.fleetId === bossFleetId;
  const missingFromBossFleet = !c.isBoss && bossFleetId != null && c.fleetId !== bossFleetId;
  const corpLabel = c.corporationTicker ? `[${c.corporationTicker}]` : '';
  const implantsTitle = c.implantNames.length ? c.implantNames.join('\n') : 'No implants';

  // AU-79 is a cosmetic/special implant that shouldn't count when judging the character's pod.
  const relevantImplants = c.implantNames.filter(n => !/AU-?79/i.test(n));
  const hasImplants = relevantImplants.length > 0;
  const hasVirtue = relevantImplants.some(n => /virtue/i.test(n));
  const hasWrongImplants = hasImplants && !hasVirtue;
  const rowClass = [
    'prow',
    c.needsReauth && 'needs-reauth',
    c.isBoss && 'is-boss',
    hasVirtue && 'has-virtue',
    hasWrongImplants && 'has-wrong-implants',
  ].filter(Boolean).join(' ');

  return (
    <div className={rowClass} style={gridStyle}>
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
          {c.isBoss && <span className="boss">BOSS</span>}
          {inBossFleet && <span className="pill ok">✓</span>}
          {missingFromBossFleet && <span className="pill warn">×</span>}
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
        <div className="value">
          {formatSp(c.totalSp)}
          {c.unallocatedSp != null && c.unallocatedSp > 0 && (
            <span className="free"> +{formatSp(c.unallocatedSp)}</span>
          )}
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
    </div>
  );
}

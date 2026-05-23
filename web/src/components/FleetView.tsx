import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchFleetRoster,
  kickFromFleet,
  moveToSquad,
  type CharacterStatus,
  type FleetRoster,
  type FleetRosterMember,
} from '../api.ts';

interface Props { chars: CharacterStatus[] }

interface DragPayload {
  kind: 'member' | 'squad' | 'wing';
  // For member: a single id. For squad/wing: every member ID inside.
  characterIds: number[];
  // Source group label for cosmetic feedback during drag.
  sourceLabel: string;
}

export function FleetView({ chars }: Props) {
  // Persist FC choice across reloads.
  const [actorId, setActorId] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem('efd.fleet.actorId'));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });
  useEffect(() => {
    if (actorId != null) localStorage.setItem('efd.fleet.actorId', String(actorId));
  }, [actorId]);

  // Default to whichever pilot is the current boss; else first pilot.
  useEffect(() => {
    if (actorId != null) return;
    const boss = chars.find(c => c.isBoss);
    if (boss) setActorId(boss.characterId);
    else if (chars.length > 0) setActorId(chars[0].characterId);
  }, [chars, actorId]);

  const [roster, setRoster] = useState<FleetRoster | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyMove, setBusyMove] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (actorId == null) return;
    setLoading(true);
    setRoster(await fetchFleetRoster(actorId));
    setLoading(false);
  }, [actorId]);

  useEffect(() => { reload(); }, [reload]);

  // Auto-refresh while the view is open (poll every 10s — fleet membership
  // changes from in-client invites/kicks happen often).
  useEffect(() => {
    if (actorId == null) return;
    const t = setInterval(() => reload(), 10_000);
    return () => clearInterval(t);
  }, [actorId, reload]);

  const grouped = useMemo(() => groupRoster(roster), [roster]);

  const handleDrop = async (target: { wingId: number; squadId: number }, payload: DragPayload) => {
    if (actorId == null || payload.characterIds.length === 0) return;
    setBusyMove(true);
    setLastResult(null);
    const r = await moveToSquad(payload.characterIds, { wing_id: target.wingId, squad_id: target.squadId }, actorId);
    setBusyMove(false);
    if (r.error) setLastResult(`error: ${r.error}`);
    else {
      const ok = r.results.filter(x => x.ok).length;
      const fail = r.results.length - ok;
      setLastResult(`moved ${ok}${fail ? ` · ${fail} failed` : ''}`);
    }
    await reload();
  };

  const onKick = async (member: FleetRosterMember) => {
    if (actorId == null) return;
    if (!confirm(`Kick ${member.characterName} from the fleet?`)) return;
    const r = await kickFromFleet(member.characterId, actorId);
    if (!r.ok) alert(r.error ?? 'kick failed');
    await reload();
  };

  return (
    <main className="rows-wrap fleet-view">
      <div className="fl-controls">
        <div className="sk-control">
          <label>Acting as</label>
          <select value={actorId ?? ''} onChange={e => setActorId(Number(e.target.value) || null)}>
            <option value="">Pick a pilot…</option>
            {chars.map(c => (
              <option key={c.characterId} value={c.characterId}>
                {c.name}{c.corporationTicker ? ` [${c.corporationTicker}]` : ''}
              </option>
            ))}
          </select>
        </div>
        <button className="fl-refresh" onClick={reload} disabled={loading || busyMove}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        {lastResult && <span className="fl-result dim">{lastResult}</span>}
      </div>

      {roster?.error && <div className="empty err">{roster.error}</div>}
      {!roster?.error && roster && !roster.fleet && (
        <div className="empty">{roster.actor.name || 'Pilot'} is not currently in a fleet.</div>
      )}
      {roster?.fleet && roster.fleet.role !== 'fleet_commander' && !roster.error && (
        <div className="empty err">
          {roster.actor.name} is {roster.fleet.role}, not the fleet commander. ESI gates the roster on FC role —
          drag this character to the Fleet Commander slot in-client and refresh.
        </div>
      )}

      {grouped && (
        <div className="fl-tree">
          {grouped.fcMember && (
            <div className="fl-fc">
              <div className="fl-fc-h">Fleet Commander</div>
              <MemberRow member={grouped.fcMember} onKick={onKick} draggable={false} />
            </div>
          )}
          {grouped.wings.map(w => (
            <WingNode
              key={w.id}
              wing={w}
              onDrop={handleDrop}
              onKick={onKick}
              busyMove={busyMove}
            />
          ))}
        </div>
      )}
    </main>
  );
}

interface GroupedWing {
  id: number;
  name: string;
  commander: FleetRosterMember | null;
  squads: GroupedSquad[];
}
interface GroupedSquad {
  id: number;
  name: string;
  wingId: number;
  commander: FleetRosterMember | null;
  members: FleetRosterMember[];
  // Includes commander if present — for bulk-move drag.
  allCharacterIds: number[];
}
interface Grouped {
  fcMember: FleetRosterMember | null;
  wings: GroupedWing[];
}

function groupRoster(roster: FleetRoster | null): Grouped | null {
  if (!roster?.fleet || !roster.wings.length && !roster.members.length) return null;

  const byCharId = new Map<number, FleetRosterMember>();
  for (const m of roster.members) byCharId.set(m.characterId, m);

  const fcMember = roster.members.find(m => m.role === 'fleet_commander') ?? null;

  const wings: GroupedWing[] = roster.wings.map(w => {
    const wingCmdr = roster.members.find(m => m.wingId === w.id && m.role === 'wing_commander') ?? null;
    const squads: GroupedSquad[] = w.squads.map(sq => {
      const sqMembers = roster.members.filter(m => m.wingId === w.id && m.squadId === sq.id);
      const cmdr = sqMembers.find(m => m.role === 'squad_commander') ?? null;
      const ordinary = sqMembers.filter(m => m.role !== 'squad_commander');
      return {
        id: sq.id,
        name: sq.name || `Squad ${sq.id}`,
        wingId: w.id,
        commander: cmdr,
        members: ordinary,
        allCharacterIds: sqMembers.map(m => m.characterId),
      };
    });
    return {
      id: w.id,
      name: w.name || `Wing ${w.id}`,
      commander: wingCmdr,
      squads,
    };
  });

  return { fcMember, wings };
}

function WingNode({
  wing, onDrop, onKick, busyMove,
}: {
  wing: GroupedWing;
  onDrop: (target: { wingId: number; squadId: number }, payload: DragPayload) => void;
  onKick: (m: FleetRosterMember) => void;
  busyMove: boolean;
}) {
  const allInWing = wing.squads.flatMap(sq => sq.allCharacterIds);
  if (wing.commander) allInWing.push(wing.commander.characterId);

  const onWingDragStart = (e: React.DragEvent) => {
    setDragPayload(e, {
      kind: 'wing',
      characterIds: allInWing,
      sourceLabel: wing.name,
    });
  };

  return (
    <div className="fl-wing">
      <div
        className="fl-wing-h"
        draggable={allInWing.length > 0 && !busyMove}
        onDragStart={onWingDragStart}
        title={allInWing.length > 0 ? 'Drag the wing onto a squad to move every member' : undefined}
      >
        <span className="fl-wing-name">{wing.name}</span>
        <span className="fl-count">
          {wing.squads.reduce((n, sq) => n + sq.allCharacterIds.length, 0)
            + (wing.commander ? 1 : 0)}
        </span>
      </div>
      {wing.commander && (
        <div className="fl-wing-cmdr">
          <span className="fl-cmdr-tag">WC</span>
          <MemberRow member={wing.commander} onKick={onKick} draggable={!busyMove} />
        </div>
      )}
      <div className="fl-squads">
        {wing.squads.map(sq => (
          <SquadNode
            key={sq.id}
            squad={sq}
            onDrop={onDrop}
            onKick={onKick}
            busyMove={busyMove}
          />
        ))}
      </div>
    </div>
  );
}

function SquadNode({
  squad, onDrop, onKick, busyMove,
}: {
  squad: GroupedSquad;
  onDrop: (target: { wingId: number; squadId: number }, payload: DragPayload) => void;
  onKick: (m: FleetRosterMember) => void;
  busyMove: boolean;
}) {
  const [hover, setHover] = useState(false);

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-fleet-move')) {
      e.preventDefault();
      setHover(true);
    }
  };
  const onDragLeave = () => setHover(false);
  const onDropHandler = (e: React.DragEvent) => {
    e.preventDefault();
    setHover(false);
    const payload = readDragPayload(e);
    if (!payload) return;
    onDrop({ wingId: squad.wingId, squadId: squad.id }, payload);
  };

  const onSquadDragStart = (e: React.DragEvent) => {
    setDragPayload(e, {
      kind: 'squad',
      characterIds: squad.allCharacterIds,
      sourceLabel: squad.name,
    });
  };

  return (
    <div
      className={`fl-squad${hover ? ' drop-target' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDropHandler}
    >
      <div
        className="fl-squad-h"
        draggable={squad.allCharacterIds.length > 0 && !busyMove}
        onDragStart={onSquadDragStart}
        title={squad.allCharacterIds.length > 0 ? 'Drag the squad onto another squad to move all its members' : undefined}
      >
        <span className="fl-squad-name">{squad.name}</span>
        <span className="fl-count">{squad.allCharacterIds.length}</span>
      </div>
      {squad.commander && (
        <div className="fl-squad-cmdr">
          <span className="fl-cmdr-tag">SC</span>
          <MemberRow member={squad.commander} onKick={onKick} draggable={!busyMove} />
        </div>
      )}
      {squad.members.map(m => (
        <MemberRow key={m.characterId} member={m} onKick={onKick} draggable={!busyMove} />
      ))}
      {squad.allCharacterIds.length === 0 && (
        <div className="fl-empty-squad dim">empty</div>
      )}
    </div>
  );
}

function MemberRow({
  member, onKick, draggable,
}: {
  member: FleetRosterMember;
  onKick: (m: FleetRosterMember) => void;
  draggable: boolean;
}) {
  const onDragStart = (e: React.DragEvent) => {
    setDragPayload(e, {
      kind: 'member',
      characterIds: [member.characterId],
      sourceLabel: member.characterName,
    });
  };
  return (
    <div
      className="fl-member"
      draggable={draggable}
      onDragStart={onDragStart}
      title={draggable ? 'Drag onto a squad to move' : undefined}
    >
      <img
        className="fl-portrait"
        src={`https://images.evetech.net/characters/${member.characterId}/portrait?size=64`}
        alt=""
        width={28}
        height={28}
      />
      <div className="fl-member-name">
        <div className="fl-member-h">{member.characterName}</div>
        <div className="fl-member-sub dim">
          {member.shipTypeName} · {member.solarSystemName}
        </div>
      </div>
      <button
        className="fl-kick"
        onClick={() => onKick(member)}
        title="Kick from fleet"
      >×</button>
    </div>
  );
}

const DRAG_TYPE = 'application/x-fleet-move';

function setDragPayload(e: React.DragEvent, payload: DragPayload) {
  // Two MIME types so dragOver predicate has something to test against
  // without the dataTransfer API leaking text-form content into other apps.
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
  e.dataTransfer.setData('text/plain', payload.sourceLabel);
  e.dataTransfer.effectAllowed = 'move';
}

function readDragPayload(e: React.DragEvent): DragPayload | null {
  try {
    const json = e.dataTransfer.getData(DRAG_TYPE);
    return json ? (JSON.parse(json) as DragPayload) : null;
  } catch {
    return null;
  }
}

import { useEffect, useState } from 'react';
import {
  fetchFleetStructure,
  inviteAll,
  moveToSquad,
  type CharacterStatus,
  type FleetStructure,
  type InviteResult,
} from '../api.ts';

interface Props {
  chars: CharacterStatus[];
  selection: Set<number>;
  defaultExpanded: boolean;
}

export function FleetInviteWidget({ chars, selection, defaultExpanded }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [resultsLabel, setResultsLabel] = useState<'invited' | 'moved'>('invited');
  const [error, setError] = useState<string | null>(null);
  const [structure, setStructure] = useState<FleetStructure | null>(null);
  const [targetKey, setTargetKey] = useState<string>('auto');
  const [pokeNonce, setPokeNonce] = useState(0);

  const boss = chars.find(c => c.isBoss);
  const bossInFleet = boss?.fleetId != null;
  const bossIsFC = boss?.fleetRole === 'fleet_commander';
  const fleetBossId = structure?.fleet?.fleet_boss_id;
  const bossIsFleetOwner = boss != null && fleetBossId != null && boss.characterId === fleetBossId;
  const bossNotOwner = bossIsFC && fleetBossId != null && fleetBossId !== boss?.characterId;
  const selectedCharsNonBoss = chars.filter(c => selection.has(c.characterId) && !c.isBoss && !c.needsReauth);
  const wingsVisible = !!structure && structure.wings.some(w => w.squads.length > 0);

  useEffect(() => {
    if (!bossInFleet || !bossIsFC) {
      setStructure(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const next = await fetchFleetStructure().catch(() => null);
      if (cancelled) return;
      setStructure(next);
      const haveWings = next && next.wings.some(w => w.squads.length > 0);
      if (!haveWings) timer = setTimeout(tick, 2_500);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [bossInFleet, bossIsFC, boss?.fleetId, pokeNonce]);

  const parsedTarget = (() => {
    if (targetKey === 'auto' || !structure) return undefined;
    const [w, s] = targetKey.split(':').map(Number);
    if (!Number.isFinite(w) || !Number.isFinite(s)) return undefined;
    return { wing_id: w, squad_id: s };
  })();

  const moveable = selectedCharsNonBoss.filter(c => c.fleetId != null && c.fleetId === boss?.fleetId);
  const canInvite = !!boss && bossInFleet && bossIsFC && wingsVisible && selectedCharsNonBoss.length > 0;
  const canMove = bossIsFC && parsedTarget != null && moveable.length > 0;

  const doInviteAll = async () => {
    setBusy(true);
    setError(null);
    setResults(null);
    const result = await inviteAll(selectedCharsNonBoss.map(c => c.characterId), parsedTarget);
    setBusy(false);
    if (result.error) setError(result.error);
    else {
      setResultsLabel('invited');
      setResults(result.results);
    }
  };

  const doMove = async () => {
    if (!parsedTarget) return;
    setBusy(true);
    setError(null);
    setResults(null);
    const result = await moveToSquad(moveable.map(c => c.characterId), parsedTarget);
    setBusy(false);
    if (result.error) setError(result.error);
    else {
      setResultsLabel('moved');
      setResults(result.results);
    }
  };

  const fcOpts = (structure?.wings ?? []).flatMap(w =>
    w.squads.map(s => ({
      key: `${w.id}:${s.id}`,
      label: `${w.name || `Wing ${w.id}`} / ${s.name || `Squad ${s.id}`}`,
    })),
  );
  const fleetIdForFallback = boss?.fleetId ?? chars.find(c => c.fleetId != null)?.fleetId;
  const memberOpts: Array<{ key: string; label: string }> = [];
  if (fleetIdForFallback != null) {
    const seen = new Set<string>();
    for (const c of chars) {
      if (c.fleetId !== fleetIdForFallback || c.fleetWingId == null || c.fleetSquadId == null) continue;
      const key = `${c.fleetWingId}:${c.fleetSquadId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const occupants = chars.filter(c2 => c2.fleetWingId === c.fleetWingId && c2.fleetSquadId === c.fleetSquadId).length;
      memberOpts.push({
        key,
        label: `Wing ${c.fleetWingId} / Squad ${c.fleetSquadId}  (${occupants} of yours here)`,
      });
    }
  }

  const seenFc = new Set(fcOpts.map(o => o.key));
  const fallbackOpts = memberOpts.filter(m => !seenFc.has(m.key));
  const hasTargets = fcOpts.length > 0 || fallbackOpts.length > 0;

  return (
    <section className={`fleet-invite-widget${expanded ? '' : ' collapsed'}`} aria-label="Fleet invite tools">
      <div className="tool-widget-head">
        <div>
          <h2>Fleet invite</h2>
          <p>{selection.size} selected · {selectedCharsNonBoss.length} invite-ready</p>
        </div>
        <div className="tool-widget-head-actions">
          {expanded && (
            <button className="ghost" onClick={() => setPokeNonce(n => n + 1)}>
              Check now
            </button>
          )}
          <button
            className="ghost fleet-invite-toggle"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="fleet-invite-body">
          <div className="fleet-invite-grid">
            <div className="fleet-boss-card">
              <span>Fleet boss</span>
              <strong>{boss ? boss.name : 'Pick a boss on Pilots'}</strong>
              {boss && (
                <small className={bossInFleet && bossIsFC && bossIsFleetOwner ? 'ok' : 'warn'}>
                  {!bossInFleet && 'Not in a fleet — form one in-client.'}
                  {bossInFleet && bossIsFC && bossIsFleetOwner && `Fleet boss · fleet ${boss.fleetId}`}
                  {bossInFleet && bossIsFC && bossNotOwner && `FC role but not fleet owner. Transfer Fleet Boss to ${boss.name} in-client.`}
                  {bossInFleet && !bossIsFC && `Currently ${boss.fleetRole ?? 'member'}. Move this pilot to Fleet Commander in-client.`}
                </small>
              )}
            </div>

            <label className="fleet-target-control">
              <span>Invite / move target</span>
              {hasTargets ? (
                <select value={targetKey} onChange={e => setTargetKey(e.target.value)}>
                  <option value="auto">Auto (first wing with a squad)</option>
                  {fcOpts.length > 0 && (
                    <optgroup label="From FC token">
                      {fcOpts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </optgroup>
                  )}
                  {fallbackOpts.length > 0 && (
                    <optgroup label="Known via your pilots">
                      {fallbackOpts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </optgroup>
                  )}
                </select>
              ) : (
                <small className="warn">
                  {bossNotOwner
                    ? `${boss?.name} is FC, but not the original fleet owner. Transfer Fleet Boss in-client.`
                    : structure?.error ?? 'Waiting for fleet wings from ESI.'}
                </small>
              )}
            </label>
          </div>

          <div className="fleet-invite-actions">
            <button className="primary" disabled={!canInvite || busy} onClick={doInviteAll}>
              {busy ? 'Working...' : `Invite selected (${selectedCharsNonBoss.length})`}
            </button>
            <button
              disabled={!canMove || busy}
              onClick={doMove}
              title={
                !bossIsFC ? 'Boss must be in the Fleet Commander slot to move pilots via ESI'
                : !parsedTarget ? 'Pick a specific wing/squad above to move into'
                : moveable.length === 0 ? 'No selected characters are in the boss fleet'
                : `Move ${moveable.length} to the chosen squad`
              }
            >
              {busy ? 'Working...' : `Move selected to target (${moveable.length})`}
            </button>
          </div>

          {error && <div className="tool-widget-error">{error}</div>}
        </div>
      )}
      {results && (
        <div className="fleet-results-modal" role="dialog" aria-modal="true" aria-label="Fleet command results">
          <div className="fleet-results-panel">
            <div className="fleet-results-head">
              <div>
                <h3>{resultsLabel === 'invited' ? 'Fleet invite results' : 'Fleet move results'}</h3>
                <p>{results.length} pilots processed</p>
              </div>
              <button type="button" onClick={() => setResults(null)} aria-label="Close fleet results">
                X
              </button>
            </div>
            <div className="fleet-results-list">
              {results.map(r => (
                <div key={r.characterId} className="row">
                  <span>{r.name}</span>
                  <span className={r.ok ? 'ok' : 'err'}>{r.ok ? resultsLabel : r.error}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

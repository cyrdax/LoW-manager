import { esiPost } from './client.ts';

export interface WaypointParams {
  destination_id: number;
  add_to_beginning?: boolean;
  clear_other_waypoints?: boolean;
}

/**
 * Sets an autopilot waypoint in the character's live client. Requires character to be logged in.
 * ESI returns 204 on success (our client handles empty body).
 * Note: /ui/autopilot/waypoint/ takes params in the query string, not the body.
 */
export async function setAutopilotWaypoint(characterId: number, params: WaypointParams): Promise<void> {
  const qs = new URLSearchParams({
    destination_id: String(params.destination_id),
    add_to_beginning: String(params.add_to_beginning ?? false),
    clear_other_waypoints: String(params.clear_other_waypoints ?? true),
  });
  await esiPost(`/ui/autopilot/waypoint/?${qs.toString()}`, characterId);
}

/**
 * Pops the in-client "show info" window for a type/character/etc on the running
 * client. Requires `esi-ui.open_window.v1` scope and the character to be logged
 * in. Skill type IDs are valid targets (the info card shows the skill).
 * Returns 204 on success.
 */
export async function openInformationWindow(characterId: number, targetId: number): Promise<void> {
  const qs = new URLSearchParams({ target_id: String(targetId) });
  await esiPost(`/ui/openwindow/information/?${qs.toString()}`, characterId);
}

/**
 * Pops the in-client market details window for a type. Skill books share their
 * skill's typeID, so the same ID works for both kinds of "show me how to buy this."
 */
export async function openMarketDetailsWindow(characterId: number, typeId: number): Promise<void> {
  const qs = new URLSearchParams({ type_id: String(typeId) });
  await esiPost(`/ui/openwindow/marketdetails/?${qs.toString()}`, characterId);
}

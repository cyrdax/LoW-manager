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

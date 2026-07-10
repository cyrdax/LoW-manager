export const SCOPES = [
  'esi-location.read_location.v1',
  'esi-location.read_ship_type.v1',
  'esi-location.read_online.v1',
  'esi-wallet.read_character_wallet.v1',
  'esi-skills.read_skillqueue.v1',
  'esi-skills.read_skills.v1',
  'esi-clones.read_implants.v1',
  'esi-fleets.read_fleet.v1',
  'esi-fleets.write_fleet.v1',
  'esi-ui.write_waypoint.v1',
  'esi-ui.open_window.v1',
  'esi-planets.manage_planets.v1',
  'esi-mail.send_mail.v1',
  'esi-fittings.write_fittings.v1',
  'esi-universe.read_structures.v1',
] as const;

export const SCOPE_STRING = SCOPES.join(' ');

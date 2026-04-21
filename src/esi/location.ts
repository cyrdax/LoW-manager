import { esiGet } from './client.ts';

export interface EsiLocation {
  solar_system_id: number;
  station_id?: number;
  structure_id?: number;
}

export interface EsiShip {
  ship_type_id: number;
  ship_item_id: number;
  ship_name: string;
}

export interface EsiOnline {
  online: boolean;
  last_login?: string;
  last_logout?: string;
  logins?: number;
}

export const getLocation = (id: number) => esiGet<EsiLocation>(`/characters/${id}/location/`, id);
export const getOnline = (id: number) => esiGet<EsiOnline>(`/characters/${id}/online/`, id);

export async function getShip(id: number) {
  const res = await esiGet<EsiShip>(`/characters/${id}/ship/`, id);
  return { ...res, data: { ...res.data, ship_name: decodePyRepr(res.data.ship_name) } };
}

/**
 * ESI returns ship names containing non-ASCII characters as Python-style repr:
 *   u'\u30e0 FantasticScans&Where2FindThem'
 * Strip the u'...' wrapper and decode \uXXXX / \xXX escapes to their actual characters.
 * If the string isn't in that form, return it unchanged.
 */
export function decodePyRepr(s: string): string {
  if (!s) return s;
  const m = s.match(/^u(['"])([\s\S]*)\1$/);
  if (!m) return s;
  // Only decode when the content actually has an escape sequence — otherwise leave
  // a string like u'foo' alone in case someone genuinely named their ship that.
  if (!/\\[uUxntr"'\\]/.test(m[2])) return s;
  return m[2]
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\U([0-9a-fA-F]{8})/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

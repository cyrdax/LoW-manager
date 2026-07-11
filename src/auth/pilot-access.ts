import type { FastifyReply, FastifyRequest } from 'fastify';
import { createSqliteCharacterStore } from '../characters/store.ts';
import type { CharacterRow } from '../types.ts';
import {
  createCurrentUserResolver,
  type CurrentAppUser,
  type CurrentUserResolver,
} from './current-user.ts';

export type { CurrentUserResolver } from './current-user.ts';

export type OwnsCharacter = (userId: string, characterId: number) => boolean;
export type GetOwnedCharacter = (userId: string, characterId: number) => CharacterRow | undefined;
export type ListUsableCharacters = (userId: string) => CharacterRow[];

export interface PilotAccessRouteDeps {
  currentUser?: CurrentUserResolver;
}

const defaultCharacters = createSqliteCharacterStore();

export function routeCurrentUser(deps: PilotAccessRouteDeps = {}): CurrentUserResolver {
  let defaultResolver: CurrentUserResolver | null = null;
  return req => (deps.currentUser ?? (defaultResolver ??= createCurrentUserResolver()))(req);
}

export async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
  currentUser: CurrentUserResolver,
): Promise<CurrentAppUser | null> {
  const user = await currentUser(req);
  if (!user) {
    reply.code(401).send({ error: 'authentication_required' });
    return null;
  }
  return user;
}

export function ownsCharacter(userId: string, characterId: number): boolean {
  return defaultCharacters.owns(userId, characterId);
}

export function getOwnedCharacter(userId: string, characterId: number): CharacterRow | undefined {
  return defaultCharacters.getOwned(userId, characterId);
}

export function requireOwnedCharacter(
  userId: string,
  characterId: number,
  reply: FastifyReply,
  check: OwnsCharacter | undefined = ownsCharacter,
): boolean {
  if ((check ?? ownsCharacter)(userId, characterId)) return true;
  reply.code(403).send({ error: 'character_not_owned' });
  return false;
}

export function listUsableCharacters(userId: string): CharacterRow[] {
  return defaultCharacters.listUsableByUser(userId);
}

export function userCharacterIds(userId: string): Set<number> {
  return new Set(defaultCharacters.listIdsByUser(userId));
}

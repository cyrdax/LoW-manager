import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createSqliteCharacterStore,
} from '../characters/store.ts';
import type { CharacterRow } from '../types.ts';
import {
  createCurrentUserResolver,
  type CurrentAppUser,
  type CurrentUserResolver,
} from './current-user.ts';

export type { CurrentUserResolver } from './current-user.ts';

export type OwnsCharacter = (userId: string, characterId: number) => boolean | Promise<boolean>;
export type GetOwnedCharacter = (userId: string, characterId: number) => CharacterRow | undefined | Promise<CharacterRow | undefined>;
export type ListUsableCharacters = (userId: string) => CharacterRow[] | Promise<CharacterRow[]>;

export interface PilotAccessRouteDeps {
  currentUser?: CurrentUserResolver;
}

type MaybePromise<T> = T | Promise<T>;

interface PilotAccessCharacterStore {
  listByUser(userId: string): MaybePromise<CharacterRow[]>;
  listUsableByUser(userId: string): MaybePromise<CharacterRow[]>;
  listIdsByUser(userId: string): MaybePromise<number[]>;
  getOwned(userId: string, characterId: number): MaybePromise<CharacterRow | undefined>;
  owns(userId: string, characterId: number): MaybePromise<boolean>;
}

let defaultCharacters: PilotAccessCharacterStore | null = null;

function defaultCharacterStore(): PilotAccessCharacterStore {
  return defaultCharacters ??= createSqliteCharacterStore();
}

export function setPilotAccessCharacterStore(store: PilotAccessCharacterStore): () => void {
  const previous = defaultCharacters;
  defaultCharacters = store;
  return () => {
    defaultCharacters = previous;
  };
}

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

export function ownsCharacter(userId: string, characterId: number): boolean | Promise<boolean> {
  return defaultCharacterStore().owns(userId, characterId);
}

export async function getOwnedCharacter(userId: string, characterId: number): Promise<CharacterRow | undefined> {
  return defaultCharacterStore().getOwned(userId, characterId);
}

export async function requireOwnedCharacter(
  userId: string,
  characterId: number,
  reply: FastifyReply,
  check: OwnsCharacter | undefined = ownsCharacter,
): Promise<boolean> {
  if (await (check ?? ownsCharacter)(userId, characterId)) return true;
  reply.code(403).send({ error: 'character_not_owned' });
  return false;
}

export async function listUsableCharacters(userId: string): Promise<CharacterRow[]> {
  return defaultCharacterStore().listUsableByUser(userId);
}

export async function getFleetBossCharacter(userId: string): Promise<CharacterRow | undefined> {
  return (await defaultCharacterStore().listByUser(userId)).find(row => row.is_boss === 1);
}

export async function listFleetInviteCharacters(userId: string): Promise<CharacterRow[]> {
  return (await defaultCharacterStore().listUsableByUser(userId)).filter(row => row.is_boss === 0);
}

export async function userCharacterIds(userId: string): Promise<Set<number>> {
  return new Set(await defaultCharacterStore().listIdsByUser(userId));
}

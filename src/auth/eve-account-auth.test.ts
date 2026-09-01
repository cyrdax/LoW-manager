import assert from 'node:assert/strict';
import test from 'node:test';
import type { EncryptedSecret } from './secret-box.ts';
import type { QueryClient } from '../db/migrations.ts';
import {
  createEveAccountAuthService,
  EveAccountAuthError,
  type EveAccountAuthInput,
} from './eve-account-auth.ts';

const NOW = new Date('2026-09-01T00:00:00Z');
const KEY = Buffer.alloc(32, 12);

function authorization(characterId = 9001): EveAccountAuthInput {
  return {
    characterId,
    characterName: characterId === 9001 ? 'Aura Example' : 'Second Example',
    ownerHash: `owner-${characterId}`,
    scopes: 'esi-assets.read_assets.v1',
    refreshToken: `refresh-${characterId}`,
    accessToken: `access-${characterId}`,
    accessTokenExpiresAt: Date.parse('2026-09-01T01:00:00Z'),
  };
}

test('EVE account auth atomically creates an email-null user identity pilot and main pilot', async () => {
  const client = new FakeClient();
  const service = createEveAccountAuthService(client, { now: () => NOW, secretKey: KEY });

  const first = await service.complete(authorization(9001));
  const second = await service.complete(authorization(9002));

  assert.deepEqual({ created: first.created, backfilled: first.backfilled }, { created: true, backfilled: false });
  assert.equal(first.user.email, null);
  assert.equal(first.user.status, 'active');
  assert.equal(first.user.role, 'admin');
  assert.equal(first.user.mainCharacterId, 9001);
  assert.equal(second.user.role, 'user');
  assert.equal(client.identities.get(9001)?.user_id, first.user.id);
  assert.equal(client.pilots.get(9001)?.user_id, first.user.id);
  assert.notEqual(client.pilots.get(9001)?.refresh_token_enc.ciphertext, 'refresh-9001');
  assert.equal(client.queries.some(query => query.text.includes('pg_advisory_xact_lock') && query.params?.[0] === 9001), true);
  assert.equal(client.inTransaction, false);
});

test('EVE account auth repeats into the same account and preserves an existing main pilot', async () => {
  const client = new FakeClient();
  const service = createEveAccountAuthService(client, { now: () => NOW, secretKey: KEY });
  const first = await service.complete(authorization());
  client.users.get(first.user.id)!.main_character_id = 777;

  const repeated = await service.complete({
    ...authorization(),
    characterName: 'Aura Renamed',
    refreshToken: 'refresh-new',
  });

  assert.deepEqual({ created: repeated.created, backfilled: repeated.backfilled }, { created: false, backfilled: false });
  assert.equal(repeated.user.id, first.user.id);
  assert.equal(repeated.user.mainCharacterId, 777);
  assert.equal(client.users.size, 1);
  assert.equal(client.identities.size, 1);
  assert.equal(client.pilots.get(9001)?.character_name, 'Aura Renamed');
});

test('EVE account auth backfills a matching legacy pilot into its existing account', async () => {
  const client = new FakeClient();
  const user = client.seedUser({ id: 'legacy-user', role: 'user' });
  client.seedPilot({ characterId: 9001, userId: user.id, ownerHash: 'owner-9001' });
  const service = createEveAccountAuthService(client, { now: () => NOW, secretKey: KEY });

  const result = await service.complete(authorization());

  assert.deepEqual({ created: result.created, backfilled: result.backfilled }, { created: false, backfilled: true });
  assert.equal(result.user.id, 'legacy-user');
  assert.equal(result.user.mainCharacterId, 9001);
  assert.equal(client.identities.get(9001)?.user_id, 'legacy-user');
  assert.equal(client.users.size, 1);
});

test('EVE account auth rejects changed owners for identities and legacy pilots', async () => {
  const identityClient = new FakeClient();
  const identityService = createEveAccountAuthService(identityClient, { now: () => NOW, secretKey: KEY });
  await identityService.complete(authorization());

  await assert.rejects(
    identityService.complete({ ...authorization(), ownerHash: 'transferred-owner' }),
    (error: unknown) => error instanceof EveAccountAuthError && error.code === 'eve_owner_mismatch',
  );
  assert.equal(identityClient.identities.get(9001)?.owner_hash, 'owner-9001');

  const legacyClient = new FakeClient();
  const user = legacyClient.seedUser({ id: 'legacy-user', role: 'user' });
  legacyClient.seedPilot({ characterId: 9001, userId: user.id, ownerHash: 'original-owner' });
  const legacyService = createEveAccountAuthService(legacyClient, { now: () => NOW, secretKey: KEY });

  await assert.rejects(
    legacyService.complete({ ...authorization(), ownerHash: 'transferred-owner' }),
    (error: unknown) => error instanceof EveAccountAuthError && error.code === 'eve_owner_mismatch',
  );
  assert.equal(legacyClient.identities.size, 0);
  assert.equal(legacyClient.pilots.get(9001)?.user_id, 'legacy-user');
});

test('EVE account auth rejects inactive accounts and rolls back partial creation', async () => {
  const inactiveClient = new FakeClient();
  const inactive = inactiveClient.seedUser({ id: 'disabled-user', role: 'user', status: 'disabled' });
  inactiveClient.seedIdentity({ characterId: 9001, userId: inactive.id, ownerHash: 'owner-9001' });
  const inactiveService = createEveAccountAuthService(inactiveClient, { now: () => NOW, secretKey: KEY });

  await assert.rejects(
    inactiveService.complete(authorization()),
    (error: unknown) => error instanceof EveAccountAuthError && error.code === 'account_not_active',
  );

  const failingClient = new FakeClient();
  failingClient.failOn = 'INSERT INTO user_eve_accounts';
  const failingService = createEveAccountAuthService(failingClient, { now: () => NOW, secretKey: KEY });

  await assert.rejects(failingService.complete(authorization()), /injected database failure/);
  assert.equal(failingClient.users.size, 0);
  assert.equal(failingClient.identities.size, 0);
  assert.equal(failingClient.pilots.size, 0);
  assert.equal(failingClient.queries.some(query => query.text === 'ROLLBACK'), true);
  assert.equal(failingClient.inTransaction, false);
});

interface UserRow {
  id: string;
  email: string | null;
  email_verified_at: Date | null;
  role: 'user' | 'admin';
  status: 'active' | 'disabled' | 'deleted';
  main_character_id: number | null;
  last_active_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface IdentityRow {
  character_id: number;
  user_id: string;
  owner_hash: string;
  linked_at: Date;
  last_login_at: Date;
}

interface PilotRow {
  character_id: number;
  user_id: string;
  character_name: string;
  owner_hash: string;
  scopes: string;
  refresh_token_enc: EncryptedSecret;
  access_token_enc: EncryptedSecret | null;
  access_token_expires_at: Date | null;
  added_at: Date;
  needs_reauth: boolean;
  is_boss: boolean;
}

class FakeClient implements QueryClient {
  users = new Map<string, UserRow>();
  identities = new Map<number, IdentityRow>();
  pilots = new Map<number, PilotRow>();
  queries: Array<{ text: string; params?: readonly unknown[] }> = [];
  inTransaction = false;
  failOn: string | null = null;
  private nextUser = 1;
  private snapshot: { users: Map<string, UserRow>; identities: Map<number, IdentityRow>; pilots: Map<number, PilotRow> } | null = null;

  seedUser(input: { id: string; role: 'user' | 'admin'; status?: UserRow['status'] }): UserRow {
    const row: UserRow = {
      id: input.id,
      email: null,
      email_verified_at: null,
      role: input.role,
      status: input.status ?? 'active',
      main_character_id: null,
      last_active_at: null,
      created_at: NOW,
      updated_at: NOW,
      deleted_at: input.status === 'deleted' ? NOW : null,
    };
    this.users.set(row.id, row);
    return row;
  }

  seedIdentity(input: { characterId: number; userId: string; ownerHash: string }): void {
    this.identities.set(input.characterId, {
      character_id: input.characterId,
      user_id: input.userId,
      owner_hash: input.ownerHash,
      linked_at: NOW,
      last_login_at: NOW,
    });
  }

  seedPilot(input: { characterId: number; userId: string; ownerHash: string }): void {
    this.pilots.set(input.characterId, {
      character_id: input.characterId,
      user_id: input.userId,
      character_name: 'Legacy Pilot',
      owner_hash: input.ownerHash,
      scopes: 'legacy-scope',
      refresh_token_enc: envelope('legacy-refresh'),
      access_token_enc: envelope('legacy-access'),
      access_token_expires_at: NOW,
      added_at: NOW,
      needs_reauth: false,
      is_boss: false,
    });
  }

  async query<T>(text: string, params?: readonly unknown[]) {
    this.queries.push({ text, params });
    if (this.failOn && text.includes(this.failOn)) throw new Error('injected database failure');
    if (text === 'BEGIN') {
      this.inTransaction = true;
      this.snapshot = {
        users: cloneMap(this.users),
        identities: cloneMap(this.identities),
        pilots: cloneMap(this.pilots),
      };
      return result<T>();
    }
    if (text === 'COMMIT') {
      this.inTransaction = false;
      this.snapshot = null;
      return result<T>();
    }
    if (text === 'ROLLBACK') {
      this.inTransaction = false;
      if (this.snapshot) {
        this.users = this.snapshot.users;
        this.identities = this.snapshot.identities;
        this.pilots = this.snapshot.pilots;
      }
      this.snapshot = null;
      return result<T>();
    }
    if (text.includes('pg_advisory_xact_lock')) return result<T>([{ pg_advisory_xact_lock: null }]);
    if (text.includes('FROM user_eve_accounts e') && text.includes('JOIN app_users u')) {
      const identity = this.identities.get(Number(params?.[0]));
      const user = identity ? this.users.get(identity.user_id) : undefined;
      return result<T>(identity && user ? [{ ...user, identity_owner_hash: identity.owner_hash }] : []);
    }
    if (text.includes('FROM characters c') && text.includes('JOIN app_users u')) {
      const pilot = this.pilots.get(Number(params?.[0]));
      const user = pilot ? this.users.get(pilot.user_id) : undefined;
      return result<T>(pilot && user ? [{ ...user, pilot_owner_hash: pilot.owner_hash }] : []);
    }
    if (text.includes('SELECT CASE') && text.includes('FROM app_users')) {
      const hasAdmin = Array.from(this.users.values()).some(user => user.role === 'admin' && user.status !== 'deleted');
      return result<T>([{ role: hasAdmin ? 'user' : 'admin' }]);
    }
    if (text.includes('INSERT INTO app_users')) {
      const id = `user-${this.nextUser++}`;
      const row: UserRow = {
        id,
        email: null,
        email_verified_at: null,
        role: params?.[0] as UserRow['role'],
        status: 'active',
        main_character_id: null,
        last_active_at: null,
        created_at: params?.[1] as Date,
        updated_at: params?.[1] as Date,
        deleted_at: null,
      };
      this.users.set(id, row);
      return result<T>([row]);
    }
    if (text.includes('INSERT INTO user_eve_accounts')) {
      const row: IdentityRow = {
        character_id: Number(params?.[0]),
        user_id: String(params?.[1]),
        owner_hash: String(params?.[2]),
        linked_at: params?.[3] as Date,
        last_login_at: params?.[3] as Date,
      };
      this.identities.set(row.character_id, row);
      return result<T>([row]);
    }
    if (text.includes('UPDATE user_eve_accounts')) {
      const row = this.identities.get(Number(params?.[0]));
      if (!row) return result<T>();
      row.last_login_at = params?.[1] as Date;
      return result<T>([row]);
    }
    if (text.includes('UPDATE app_users') && text.includes('COALESCE(main_character_id')) {
      const user = this.users.get(String(params?.[0]));
      if (!user) return result<T>();
      user.main_character_id ??= Number(params?.[1]);
      user.updated_at = params?.[2] as Date;
      return result<T>([user]);
    }
    if (text.includes('SELECT user_id, owner_hash FROM characters')) {
      const pilot = this.pilots.get(Number(params?.[0]));
      return result<T>(pilot ? [{ user_id: pilot.user_id, owner_hash: pilot.owner_hash }] : []);
    }
    if (text.includes('INSERT INTO characters')) {
      const row: PilotRow = {
        character_id: Number(params?.[0]),
        user_id: String(params?.[1]),
        character_name: String(params?.[2]),
        owner_hash: String(params?.[3]),
        scopes: String(params?.[4]),
        refresh_token_enc: params?.[5] as EncryptedSecret,
        access_token_enc: params?.[6] as EncryptedSecret | null,
        access_token_expires_at: params?.[7] as Date | null,
        added_at: this.pilots.get(Number(params?.[0]))?.added_at ?? params?.[8] as Date,
        needs_reauth: false,
        is_boss: this.pilots.get(Number(params?.[0]))?.is_boss ?? false,
      };
      this.pilots.set(row.character_id, row);
      return result<T>([row]);
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

function result<T>(rows: unknown[] = []): T {
  return { rows, rowCount: rows.length } as T;
}

function cloneMap<K, V>(source: Map<K, V>): Map<K, V> {
  return new Map(Array.from(source, ([key, value]) => [key, structuredClone(value)]));
}

function envelope(value: string): EncryptedSecret {
  return { v: 1, alg: 'A256GCM', iv: '', tag: '', ciphertext: value };
}

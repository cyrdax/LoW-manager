import assert from 'node:assert/strict';
import test from 'node:test';
import { postgresTestConfig, truncatePostgresTables } from './postgres-test.ts';

test('postgresTestConfig requires both main and test database urls', () => {
  assert.equal(postgresTestConfig({}), null);
  assert.equal(postgresTestConfig({ DATABASE_URL: 'postgres://x/db' }), null);
  assert.deepEqual(
    postgresTestConfig({
      DATABASE_URL: 'postgres://x/main',
      TEST_DATABASE_URL: 'postgres://x/main_test',
    }),
    {
      databaseUrl: 'postgres://x/main',
      testDatabaseUrl: 'postgres://x/main_test',
    },
  );
});

test('truncatePostgresTables truncates public tables except migration metadata', async () => {
  const queries: string[] = [];
  const pool = {
    query: async (sql: string) => {
      queries.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.includes('information_schema.tables')) {
        return {
          rows: [
            { table_name: 'app_users' },
            { table_name: 'schema_migrations' },
            { table_name: 'weird"name' },
          ],
        };
      }
      return { rows: [] };
    },
  };

  await truncatePostgresTables(pool as never);

  assert.equal(
    queries.at(-1),
    'TRUNCATE "app_users", "weird""name" RESTART IDENTITY CASCADE',
  );
});

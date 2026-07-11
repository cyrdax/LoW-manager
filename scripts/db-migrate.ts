import 'dotenv/config';
import { closePostgresPool, getPostgresPool } from '../src/db/postgres.ts';
import { runMigrations } from '../src/db/migrations.ts';

try {
  const result = await runMigrations(getPostgresPool());
  console.log(`Applied ${result.applied.length} migration(s). Skipped ${result.skipped.length}.`);
  for (const id of result.applied) console.log(`applied ${id}`);
} finally {
  await closePostgresPool();
}

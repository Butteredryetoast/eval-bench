import { PGlite } from '@electric-sql/pglite';
import { drizzle as pgliteDrizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as postgresDrizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import * as schema from './schema';
import { INITIAL_SQL } from './migrations';
import { stateDir } from './config';

export type Database = PgliteDatabase<typeof schema>;
export interface Store { db: Database; directory: string; close: () => Promise<void>; engine: string }
export async function createStore(directory = stateDir(), databaseUrl = process.env.CASEBENCH_DATABASE_URL): Promise<Store> {
  await mkdir(path.join(directory, 'files'), { recursive: true });
  if (databaseUrl && databaseUrl !== ':memory:') {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    await pool.query(INITIAL_SQL);
    // Both PostgreSQL drivers expose the same Drizzle query/transaction methods used here.
    const db = postgresDrizzle(pool, { schema }) as unknown as Database;
    return { db, directory, engine: 'postgresql', close: () => pool.end() };
  }
  const client = new PGlite(databaseUrl === ':memory:' ? undefined : path.join(directory, 'postgres'));
  await client.waitReady;
  await client.exec(INITIAL_SQL);
  return { db: pgliteDrizzle(client, { schema }), directory, engine: 'pglite', close: () => client.close() };
}
const globalStore = globalThis as unknown as { casebenchStore?: Promise<Store> };
export function getStore() { return globalStore.casebenchStore ??= createStore(); }

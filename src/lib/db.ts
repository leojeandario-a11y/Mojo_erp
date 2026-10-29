import "server-only";
import { isIP } from "node:net";
import { Pool, type PoolClient, type PoolConfig } from "pg";

declare global {
  var mojoPool: Pool | undefined;
}

function createPool(): Pool {
  const config: PoolConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST,
        port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
      };

  if (!config.connectionString && (!config.host || !config.database || !config.user || !config.password)) {
    throw new Error("Database configuration is incomplete. Set DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD.");
  }

  return new Pool({ ...config, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}

export function getPool(): Pool {
  if (globalThis.mojoPool) return globalThis.mojoPool;
  const pool = createPool();
  globalThis.mojoPool = pool;
  return pool;
}

export async function withDbUser<T>(
  userId: string,
  ipAddress: string | null,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.ip', $2, true)",
      [userId, ipAddress ?? ""],
    );
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function requestIp(headers: Headers): string | null {
  const forwardedFor = headers.get("x-forwarded-for");
  const candidate = forwardedFor?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim();
  return candidate && isIP(candidate) ? candidate : null;
}

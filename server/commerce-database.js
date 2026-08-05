let cachedDatabase = null;
let cachedConnection = null;

export class CommerceConfigurationError extends Error {
  constructor(code = 'backend_not_configured') {
    super(code);
    this.name = 'CommerceConfigurationError';
    this.code = code;
  }
}

function connectionString(env) {
  const value = String(env.DATABASE_URL || '').trim();
  if (!value) throw new CommerceConfigurationError();
  try {
    const parsed = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username) throw new Error('invalid');
  } catch {
    throw new CommerceConfigurationError();
  }
  return value;
}

export async function getCommerceDatabase(options = {}) {
  const env = options.env || process.env;
  const value = connectionString(env);
  if (cachedDatabase && cachedConnection === value) return cachedDatabase;
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(value, { fetchOptions: { cache: 'no-store' } });
  cachedDatabase = {
    query(statement, parameters = []) {
      return sql.query(statement, parameters, { fetchOptions: { cache: 'no-store' } });
    },
    transaction(statements) {
      return sql.transaction(statements.map(({ statement, parameters = [] }) => sql.query(statement, parameters)), {
        isolationLevel: 'Serializable'
      });
    }
  };
  cachedConnection = value;
  return cachedDatabase;
}

export function resetCommerceDatabaseForTests() {
  cachedDatabase = null;
  cachedConnection = null;
}

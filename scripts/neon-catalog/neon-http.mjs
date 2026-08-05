const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function parseDatabaseUrl(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(String(databaseUrl || ''));
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !parsed.username || !parsed.password || !parsed.hostname || parsed.pathname === '/') {
    throw new Error('DATABASE_URL must include a PostgreSQL user, password, Neon host and database name.');
  }
  if (!/(?:^|\.)neon\.tech$/i.test(parsed.hostname)) {
    throw new Error('The dependency-free HTTPS importer only accepts a Neon database host.');
  }
  return parsed;
}

export function neonSqlEndpoint(databaseUrl) {
  const parsed = parseDatabaseUrl(databaseUrl);
  const apiHost = parsed.hostname.replace(/^[^.]+\./, 'api.');
  if (apiHost === parsed.hostname) throw new Error('The Neon host is not in the expected endpoint format.');
  return `https://${apiHost}/sql`;
}

function rowsAsObjects(rawResult) {
  if (!rawResult || !Array.isArray(rawResult.fields) || !Array.isArray(rawResult.rows)) {
    throw new Error('Neon returned an unexpected SQL result shape.');
  }
  const names = rawResult.fields.map(field => String(field?.name || ''));
  return rawResult.rows.map(row => {
    if (!Array.isArray(row) || row.length !== names.length) throw new Error('Neon returned a malformed SQL row.');
    return Object.fromEntries(row.map((value, index) => [names[index], value]));
  });
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function createNeonHttpClient({
  databaseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 60_000,
  maximumAttempts = 5
}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) throw new Error('Invalid Neon request timeout.');
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 8) throw new Error('Invalid Neon retry count.');
  const endpoint = neonSqlEndpoint(databaseUrl);

  async function execute(body, transactionOptions = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Neon-Connection-String': databaseUrl,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'true'
    };
    if (Array.isArray(body.queries)) {
      headers['Neon-Batch-Isolation-Level'] = transactionOptions.isolationLevel || 'Serializable';
      headers['Neon-Batch-Read-Only'] = String(Boolean(transactionOptions.readOnly));
      headers['Neon-Batch-Deferrable'] = String(Boolean(transactionOptions.deferrable));
    }

    let lastError;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers,
          body: JSON.stringify(body)
        });
        if (response.ok) return await response.json();

        const responseText = await response.text();
        const message = (() => {
          try {
            const parsed = JSON.parse(responseText);
            return String(parsed?.message || `HTTP ${response.status}`);
          } catch {
            return `HTTP ${response.status}`;
          }
        })();
        const error = new Error(`Neon SQL request failed: ${message}`);
        error.status = response.status;
        if (!TRANSIENT_HTTP_STATUS.has(response.status) || attempt === maximumAttempts) throw error;
        lastError = error;
      } catch (error) {
        const transient = error?.name === 'AbortError'
          || error?.cause?.code
          || TRANSIENT_HTTP_STATUS.has(Number(error?.status));
        if (!transient || attempt === maximumAttempts) {
          if (error?.name === 'AbortError') throw new Error('Neon SQL request timed out.');
          throw error;
        }
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
      await sleep(Math.min(8_000, 250 * (2 ** (attempt - 1))));
    }
    throw lastError || new Error('Neon SQL request failed.');
  }

  return Object.freeze({
    endpoint,
    async query(query, params = []) {
      if (typeof query !== 'string' || !query.trim() || !Array.isArray(params)) throw new Error('Invalid SQL query request.');
      const result = await execute({ query, params });
      return { rows: rowsAsObjects(result), raw: result };
    },
    async transaction(queries, options = {}) {
      if (!Array.isArray(queries) || !queries.length) throw new Error('A Neon transaction requires at least one query.');
      const requestQueries = queries.map(item => {
        if (!item || typeof item.query !== 'string' || !item.query.trim() || !Array.isArray(item.params || [])) {
          throw new Error('Invalid SQL transaction query.');
        }
        return { query: item.query, params: item.params || [] };
      });
      const result = await execute({ queries: requestQueries }, options);
      if (!Array.isArray(result?.results) || result.results.length !== queries.length) {
        throw new Error('Neon returned an unexpected transaction result shape.');
      }
      return result.results.map(raw => ({ rows: rowsAsObjects(raw), raw }));
    }
  });
}

// Guards against ever running migrations/truncation against a real database.
// DATABASE_URL is an ambient env var set by docker-compose on the dev
// container (pointing at the real `famlin` database) — it takes precedence
// over backend/.env.test unless something explicitly overrides it before the
// test process starts. Without this check, forgetting that override and
// running `npm test` inside the dev container would TRUNCATE production/dev
// data instead of the dedicated test database.
export function assertTestDatabase() {
  const url = process.env.DATABASE_URL || '';
  let dbName = '';
  try {
    dbName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    // fall through with an empty name — treated as not-a-test-db below
  }

  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run tests against database "${dbName || '(unparseable)'}" — ` +
        `DATABASE_URL must point at a database with "test" in its name (see backend/.env.test). ` +
        `Got: ${url}`
    );
  }
}

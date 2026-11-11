// Arbitrary fixed key for a Postgres advisory lock serializing everything
// that creates or replaces a server's accounts: first-run setup, every
// restore (setup screen and admin Backups page). Unrelated to any other lock.
export const SETUP_ADVISORY_LOCK_KEY = 4_827_193n

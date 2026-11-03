/**
 * Dialect-neutral migrations. Every statement must run on both SQLite and
 * PostgreSQL, because the app supports a zero-dependency SQLite deployment and
 * a managed PostgreSQL deployment (Neon / Supabase / Railway).
 *
 * Timestamps are stored as BIGINT epoch milliseconds to avoid dialect-specific
 * timestamp types. Booleans are stored as INTEGER 0/1 for the same reason.
 */

export interface Migration {
  version: string;
  statements: string[];
}

export const migrations: Migration[] = [
  {
    version: "001_initial",
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at BIGINT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        wallet TEXT NOT NULL UNIQUE,
        wallet_verified_at BIGINT,
        signup_ip TEXT,
        created_at BIGINT NOT NULL,
        last_seen_at BIGINT,
        referral_code TEXT NOT NULL UNIQUE,
        referred_by TEXT,
        referral_credited INTEGER NOT NULL DEFAULT 0,
        x_username TEXT,
        x_user_id TEXT,
        telegram_user_id TEXT,
        telegram_username TEXT,
        telegram_linked_at BIGINT,
        hold_balance_raw TEXT,
        hold_balance_at BIGINT,
        hold_first_qualifying_at BIGINT,
        hold_days INTEGER NOT NULL DEFAULT 0,
        points_cached BIGINT NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        blocked INTEGER NOT NULL DEFAULT 0,
        risk_score INTEGER NOT NULL DEFAULT 0,
        risk_flags TEXT,
        notes TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users (referred_by)`,
      `CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_users_points ON users (points_cached)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_users_telegram ON users (telegram_user_id) WHERE telegram_user_id IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        user_id TEXT,
        admin_id TEXT,
        csrf TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        last_seen_at BIGINT,
        ip TEXT,
        user_agent TEXT,
        revoked_at BIGINT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_admin ON sessions (admin_id)`,
      `CREATE TABLE IF NOT EXISTS auth_nonces (
        nonce TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        purpose TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        used_at BIGINT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_auth_nonces_wallet ON auth_nonces (wallet)`,
      `CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until BIGINT,
        created_at BIGINT NOT NULL,
        last_login_at BIGINT
      )`,
      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        points INTEGER NOT NULL DEFAULT 0,
        max_awards INTEGER NOT NULL DEFAULT 1,
        requires_proof INTEGER NOT NULL DEFAULT 0,
        requires_holding_raw TEXT,
        min_hold_days INTEGER NOT NULL DEFAULT 0,
        auto_verify TEXT NOT NULL DEFAULT 'none',
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 100,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks (active, sort_order)`,
      `CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        proof_type TEXT,
        proof_url TEXT,
        proof_text TEXT,
        content_hash TEXT,
        points_awarded INTEGER NOT NULL DEFAULT 0,
        verification_state TEXT NOT NULL DEFAULT 'unverified',
        verification_detail TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        reviewed_at BIGINT,
        reviewed_by TEXT,
        review_note TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_submissions_task ON submissions (task_id)`,
      `CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status, created_at)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_submissions_task_content ON submissions (task_id, content_hash) WHERE content_hash IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS points_ledger (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        submission_id TEXT,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        created_by TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ledger_user ON points_ledger (user_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS holdings_snapshots (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        wallet TEXT NOT NULL,
        balance_raw TEXT NOT NULL,
        balance_formatted TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        token_address TEXT NOT NULL,
        block_number BIGINT,
        ok INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL,
        error TEXT,
        verified_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_holdings_user ON holdings_snapshots (user_id, verified_at)`,
      `CREATE TABLE IF NOT EXISTS verifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        submission_id TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        method TEXT NOT NULL,
        detail TEXT,
        checked_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_verifications_user ON verifications (user_id, checked_at)`,
      `CREATE TABLE IF NOT EXISTS payouts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount TEXT NOT NULL,
        amount_raw TEXT NOT NULL,
        tx_hash TEXT,
        status TEXT NOT NULL DEFAULT 'recorded',
        chain_id INTEGER NOT NULL,
        note TEXT,
        verification_detail TEXT,
        verified_at BIGINT,
        created_by TEXT,
        created_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts (user_id, created_at)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_payouts_tx ON payouts (tx_hash) WHERE tx_hash IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        meta TEXT,
        ip TEXT,
        created_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at)`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        updated_by TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS telegram_links (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        consumed_at BIGINT,
        telegram_user_id TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_telegram_links_user ON telegram_links (user_id)`,
      `CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        window_start BIGINT NOT NULL,
        count INTEGER NOT NULL
      )`,
    ],
  },
  {
    version: "002_pending_submission_guard",
    statements: [
      // Repair any pre-existing duplicate pending claims (keep the newest) so the
      // index below can be created without deleting data.
      `UPDATE submissions SET status = 'rejected',
         review_note = 'Superseded by migration 002: duplicate pending claim'
       WHERE status = 'pending' AND EXISTS (
         SELECT 1 FROM submissions newer
         WHERE newer.user_id = submissions.user_id
           AND newer.task_id = submissions.task_id
           AND newer.status = 'pending'
           AND (newer.created_at > submissions.created_at
                OR (newer.created_at = submissions.created_at AND newer.id > submissions.id))
       )`,
      // At most one pending claim per wallet per task, enforced by the engine so
      // two simultaneous submissions cannot both sit in the review queue.
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_submissions_pending ON submissions (user_id, task_id) WHERE status = 'pending'`,
      `CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts (status, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_submissions_user_task ON submissions (user_id, task_id)`,
    ],
  },
];

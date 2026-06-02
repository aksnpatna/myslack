-- ============================================================
-- Sovereign Tech Evolution — Phase 1 Schema Migration
-- Apply: psql -U postgres -d slack_clone_db -f server/db/sovereign_migration.sql
-- ============================================================

\connect slack_clone_db

-- ── ENUM guard: index_status ─────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'index_status') THEN
    CREATE TYPE index_status AS ENUM ('pending', 'indexing', 'ready', 'error');
  END IF;
END $$;

-- ── system_metrics: node-level telemetry (CPU, memory, latency) ─────────────
CREATE TABLE IF NOT EXISTS system_metrics (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id     TEXT          NOT NULL,
  cpu_pct     NUMERIC(5,2),
  mem_pct     NUMERIC(5,2),
  latency_ms  INT,
  recorded_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sys_metrics_time ON system_metrics(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_sys_metrics_node ON system_metrics(node_id, recorded_at DESC);

-- ── identity_mappings: real userId → obfuscated code (e.g. CONSULTANT-A7) ───
CREATE TABLE IF NOT EXISTS identity_mappings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  obfuscated_id  TEXT        NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_identity_user ON identity_mappings(user_id);

-- ── vector_index_status: RAG indexing lifecycle per attachment ───────────────
CREATE TABLE IF NOT EXISTS vector_index_status (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id     UUID          NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE CASCADE,
  status      index_status  NOT NULL DEFAULT 'pending',
  error_msg   TEXT,
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── admin_interventions: logged when agent RAG confidence is below threshold ─
CREATE TABLE IF NOT EXISTS admin_interventions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID        REFERENCES messages(id)  ON DELETE SET NULL,
  channel_id  UUID        REFERENCES channels(id)  ON DELETE SET NULL,
  query       TEXT        NOT NULL,
  confidence  NUMERIC(5,4),
  resolved    BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_interventions_unresolved
  ON admin_interventions(resolved, created_at DESC)
  WHERE resolved = false;

-- ── topics: project-led topic streams nested under channels ─────────────────
CREATE TABLE IF NOT EXISTS topics (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  slug        TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | MONITORING | RESOLVING
  created_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_topic_channel_slug UNIQUE (channel_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_topics_channel ON topics(channel_id);

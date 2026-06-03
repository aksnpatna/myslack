-- ============================================================
-- Sovereign Tech Evolution — Phase 2 Reactive Migration
-- Apply: psql -U asx_user -d slack_clone_db -f server/db/sovereign_migration_v2.sql
-- ============================================================

-- ── Extend topics with goal tracking and AI metadata ─────────────────────
ALTER TABLE topics ADD COLUMN IF NOT EXISTS goal_percentage   NUMERIC(5,2)  DEFAULT 0;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS context_confidence NUMERIC(5,4)  DEFAULT NULL;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS auto_created       BOOLEAN       DEFAULT false;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ   DEFAULT now();

-- ── Extend system_metrics with database status field ─────────────────────
ALTER TABLE system_metrics ADD COLUMN IF NOT EXISTS db_status    TEXT  DEFAULT 'online';
ALTER TABLE system_metrics ADD COLUMN IF NOT EXISTS agent_cycles INT   DEFAULT 0;

-- ── sovereignty_reports: stored admin audit reports ──────────────────────
CREATE TABLE IF NOT EXISTS sovereignty_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  report_type     TEXT        NOT NULL DEFAULT 'full_audit',
  e2ee_active     BOOLEAN     NOT NULL DEFAULT true,
  node_uptime_pct NUMERIC(5,2),
  data_residency  JSONB,
  resolution_count INT        DEFAULT 0,
  summary_md      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_time ON sovereignty_reports(created_at DESC);

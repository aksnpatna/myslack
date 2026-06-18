-- Huddle Notes — Transcription & Summarization
-- Apply: psql -U asx_user -d slack_clone_db -f server/db/huddle_notes_migration.sql

CREATE TABLE IF NOT EXISTS huddle_transcripts (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id     UUID         NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  session_id     UUID         NOT NULL,
  speaker_identity TEXT       NOT NULL,
  segment        TEXT         NOT NULL,
  sequence_num   INT          NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_huddle_transcripts_session ON huddle_transcripts(session_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_huddle_transcripts_channel ON huddle_transcripts(channel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS huddle_summaries (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id     UUID         NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  session_id     UUID         NOT NULL,
  summary_json   JSONB        NOT NULL DEFAULT '{}',
  provider       TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_huddle_summaries_channel ON huddle_summaries(channel_id, created_at DESC);

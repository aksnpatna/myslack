-- ============================================================
-- LAYER 1: ISOLATED LOGICAL DATABASE SCHEMA
-- Run as superuser: psql -U postgres
-- ============================================================

-- 1. Create isolated database
CREATE DATABASE slack_clone_db
  ENCODING 'UTF8'
  LC_COLLATE 'en_US.UTF-8'
  LC_CTYPE 'en_US.UTF-8'
  TEMPLATE template0;

\connect slack_clone_db

-- 2. Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 3. ENUMs
CREATE TYPE user_role   AS ENUM ('admin', 'member');
CREATE TYPE user_status AS ENUM ('pending', 'approved', 'rejected');

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE users (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT          NOT NULL UNIQUE,
  email         TEXT          NOT NULL UNIQUE,
  password_hash TEXT          NOT NULL,           -- bcrypt / argon2
  role          user_role     NOT NULL DEFAULT 'member',
  status        user_status   NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_status ON users(status);

-- ── Channels ─────────────────────────────────────────────────
CREATE TABLE channels (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  is_private  BOOLEAN     NOT NULL DEFAULT false,
  created_by  UUID        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Messages (thread-first via self-reference) ───────────────
CREATE TABLE messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id   UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  parent_id   UUID                 REFERENCES messages(id) ON DELETE CASCADE, -- NULL = root
  body        TEXT        NOT NULL,
  edited_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_channel    ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_thread     ON messages(parent_id)  WHERE parent_id IS NOT NULL;

-- ── Local file metadata (paths only — no binary in DB) ───────
CREATE TABLE files (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id   UUID                 REFERENCES messages(id) ON DELETE SET NULL,
  file_path    TEXT        NOT NULL,   -- absolute path on local disk
  mime_type    TEXT,
  size_bytes   BIGINT,
  original_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_files_message ON files(message_id);

-- ── Document embeddings (halfvec = 2 bytes/dim, ~3 KB/row) ───
CREATE TABLE document_embeddings (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id      UUID                   REFERENCES files(id) ON DELETE CASCADE,
  chunk_index  INT           NOT NULL DEFAULT 0,
  chunk_text   TEXT          NOT NULL,
  embedding    halfvec(1536) NOT NULL,  -- OpenAI text-embedding-3-small
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
-- HNSW index: fast ANN search, low RAM on shared hardware
CREATE INDEX idx_embeddings_hnsw
  ON document_embeddings
  USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

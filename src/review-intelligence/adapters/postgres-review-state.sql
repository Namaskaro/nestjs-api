BEGIN;
SELECT pg_advisory_xact_lock(65184721);
CREATE SCHEMA IF NOT EXISTS review_engine;

CREATE TABLE IF NOT EXISTS review_engine.cursor (
  store_id text PRIMARY KEY,
  position bigint NOT NULL DEFAULT 0 CHECK (position >= 0)
);

CREATE TABLE IF NOT EXISTS review_engine.publication (
  store_id text NOT NULL,
  review_id uuid NOT NULL,
  product_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  corpus_version integer NOT NULL CHECK (corpus_version >= 0),
  pending boolean NOT NULL DEFAULT false,
  due_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, review_id),
  UNIQUE (store_id, publication_id)
);
CREATE INDEX IF NOT EXISTS review_engine_product ON review_engine.publication
  (store_id, product_id) WHERE rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS review_engine_index_due ON review_engine.publication
  (store_id, due_at, review_id) WHERE pending;

CREATE TABLE IF NOT EXISTS review_engine.summary (
  store_id text NOT NULL,
  product_id uuid NOT NULL,
  state jsonb NOT NULL,
  due_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, product_id)
);
CREATE INDEX IF NOT EXISTS review_engine_summary_due ON review_engine.summary
  (store_id, due_at, product_id) WHERE due_at IS NOT NULL;
COMMIT;

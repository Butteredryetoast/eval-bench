CREATE TABLE IF NOT EXISTS hm_jobs (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());

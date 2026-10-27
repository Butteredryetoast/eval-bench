CREATE TABLE IF NOT EXISTS hm_events (id text PRIMARY KEY, identity text NOT NULL UNIQUE, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());

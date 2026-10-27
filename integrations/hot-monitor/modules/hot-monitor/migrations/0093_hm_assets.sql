CREATE TABLE IF NOT EXISTS hm_assets (id text PRIMARY KEY, case_id text NOT NULL REFERENCES hm_cases(id), data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

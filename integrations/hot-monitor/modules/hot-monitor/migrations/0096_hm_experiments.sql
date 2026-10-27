CREATE TABLE IF NOT EXISTS hm_experiments (id text PRIMARY KEY, event_id text NOT NULL REFERENCES hm_events(id), case_id text REFERENCES hm_cases(id), data jsonb NOT NULL);

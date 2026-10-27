CREATE TABLE IF NOT EXISTS hm_aliases (alias text PRIMARY KEY, event_id text NOT NULL REFERENCES hm_events(id));

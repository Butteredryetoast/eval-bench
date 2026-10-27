CREATE TABLE IF NOT EXISTS hm_sync_cache (path text PRIMARY KEY, etag text, valid_until timestamptz NOT NULL, data jsonb NOT NULL, retry_at timestamptz);

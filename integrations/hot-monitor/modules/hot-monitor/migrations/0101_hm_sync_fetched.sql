ALTER TABLE hm_sync_cache ADD COLUMN IF NOT EXISTS fetched_at timestamptz;

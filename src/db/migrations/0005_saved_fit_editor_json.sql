ALTER TABLE saved_fits
  ADD COLUMN IF NOT EXISTS editor_json jsonb;


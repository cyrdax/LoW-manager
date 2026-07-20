ALTER TABLE doctrines
  ADD COLUMN IF NOT EXISTS google_doc_url text NOT NULL DEFAULT '';

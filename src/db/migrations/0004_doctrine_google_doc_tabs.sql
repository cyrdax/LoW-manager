CREATE TABLE IF NOT EXISTS doctrine_tabs (
  doctrine_id bigint NOT NULL REFERENCES doctrines(id) ON DELETE CASCADE,
  tab_id text NOT NULL,
  title text NOT NULL,
  sort_order integer NOT NULL,
  PRIMARY KEY (doctrine_id, tab_id)
);

ALTER TABLE doctrine_fits
  ADD COLUMN IF NOT EXISTS google_doc_tab_id text NOT NULL DEFAULT 'default';

ALTER TABLE doctrine_fits
  ADD COLUMN IF NOT EXISTS google_doc_tab_title text NOT NULL DEFAULT 'Fits';

INSERT INTO doctrine_tabs (doctrine_id, tab_id, title, sort_order)
SELECT DISTINCT doctrine_id, google_doc_tab_id, google_doc_tab_title, 0
FROM doctrine_fits
ON CONFLICT (doctrine_id, tab_id) DO NOTHING;

ALTER TABLE doctrine_fits
  DROP CONSTRAINT IF EXISTS doctrine_fits_pkey;

ALTER TABLE doctrine_fits
  ADD PRIMARY KEY (doctrine_id, google_doc_tab_id, fit_id);

CREATE INDEX IF NOT EXISTS idx_doctrine_tabs_doctrine ON doctrine_tabs(doctrine_id, sort_order);

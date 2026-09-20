# Remove Fits V2 Design

## Goal

Remove the unusable Fits V2 product surface without disrupting the working legacy Fits and Doctrines workflows or destructively altering saved data.

## Product behavior

- The sidebar exposes only the existing Fits entry; there is no Fits V2 entry or screen.
- `/fits-v2` and `/fits/v2` resolve to the legacy Fits screen.
- `/fit-v2/:id` and `/fit/v2/:id` resolve to the same saved fit in the legacy Fits screen.
- The legacy `/fits` and `/fit/:id` routes continue to behave unchanged.
- Fits V2 editor documents are no longer accepted, returned, rendered, or used by the application.

## Removal boundary

Delete the Fits V2 React view, editor-domain implementation, V2-only styles, tests, and obsolete V2 design/implementation documents. Remove the `editorJson` API and store plumbing and the doctrine summary flag derived from it.

Keep migration `0005_saved_fit_editor_json.sql` and the database column it introduced. Existing deployments may already contain the column and stored values, so retaining the additive migration avoids a destructive schema rollback. The application will leave that data inert.

## Verification

- Route tests prove old V2 URLs land on legacy Fits and retain valid fit IDs.
- Fits route tests prove editor documents are no longer exposed.
- The full automated test suite, typecheck, and production build pass.
- Repository search confirms no live Fits V2 product references remain except the inert historical migration and removal documentation.

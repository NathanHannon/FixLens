# FixLens backend

NestJS + PostgreSQL 17, with private DigitalOcean Spaces photos. The seven modules are problems, captures, measurements, reports, diagnosis, storage, and health. The [Expo app](../rct-fixlens/) is in the sibling directory. The diagnosis provider is selectable: mock by default, or real Muse Spark + SAM inference with `DIAGNOSIS_PROVIDER=meta`. Model version strings distinguish simulated and real reports.

## Local development

Use Node.js 24 and Docker with its daemon running:

```sh
npm ci
cp .env.example .env
# PowerShell: Copy-Item .env.example .env
docker compose up -d --wait
npm run migration:run
npm run start:dev
```

Fill in real Spaces credentials before testing uploads. Keep the bucket private. The API signs direct PUT requests, checks object metadata with HEAD, and never receives photo bytes. Use the bucket's origin S3 endpoint, not its CDN endpoint. Spaces supports presigned URLs: https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/

For Expo web, configure bucket CORS to allow GET, PUT, and Content-Type from your development origin; native uploads do not require browser CORS. The API allows localhost web origins on ports 8081 and 8082 by default. Set `CORS_ORIGINS` to a comma-separated list for other web clients. The scaffold does not provision a bucket or deploy resources.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| DATABASE_URL | yes | PostgreSQL connection URL; use the managed database's TLS URL in deployment |
| SPACES_ENDPOINT | yes | Origin endpoint, e.g. `https://nyc3.digitaloceanspaces.com` |
| SPACES_KEY | yes | Spaces access key with access to the private bucket |
| SPACES_SECRET | yes | Spaces secret key |
| SPACES_BUCKET | yes | Bucket name |
| SEGMENTATION_SECRET | yes | Random server-only secret, at least 32 characters; identical on every API replica |
| PORT | no | Integer 1–65535; defaults to 3000 |

Startup rejects missing variables and invalid URLs/ports with named errors. No credentials are checked into this repository. TLS settings are supplied through DATABASE_URL; certificate verification is not disabled in code. Storage currently derives the signing region from the Spaces origin hostname. Spaces is the selected MVP provider; R2 would need its `auto` region configuration instead.

## API and upload flow

All bodies use snake_case column names. UUID path parameters are validated. Unknown fields are rejected. Responses use entity field names; Postgres numeric columns (`alignment_score`, `confidence`, `days_between`) are strings to preserve precision. Dates serialize as ISO timestamps.

| Method | Route | Body / behavior |
| --- | --- | --- |
| POST | /problems | `title`, optional `category`, `location_note` |
| GET | /problems | All demo-owned problems, newest first |
| GET | /problems/:id | Problem plus `latest_report`, `latest_measurement`, `delta_summary` (nullable) |
| POST | /problems/:id/captures/upload-url | No body; generates `capture_id`, `photo_key`, PUT URL, headers, five-minute expiry |
| POST | /problems/:id/captures | Register an uploaded photo (see below) |
| GET | /problems/:id/captures/:captureId/media | Owned capture JPEG and stored mask PNG signed GET URLs, filenames, 300-second expiry; `Cache-Control: no-store` |
| GET | /problems/:id/deltas | Read-only consecutive measured-capture deltas, newest first |
| POST | /problems/:id/segment | `capture_id`, inclusive source-pixel `selection`, optional `context`, `hazards`, `calibration`; Muse targeting + cropped SAM; returns candidate/unavailable status, reason, optional highlight/counts, signed token and expiry |
| POST | /problems/:id/diagnose | `capture_id`, `segmentation_token` from the reviewed preview, optional `hazards`, `context` |
| GET | /health | Database/schema readiness, model mode and capture-flow version; 503 if unavailable |

1. Create a problem: `POST /problems` with `{"title":"Basement wall crack","category":"crack"}`.
2. Call `/problems/<id>/captures/upload-url`. Upload the JPEG directly to the returned URL using PUT and the returned headers. The API chooses `captures/<problem_id>/<capture_id>.jpg`.
3. Register with `/problems/<id>/captures`:

```json
{
  "photo_key": "captures/<problem_id>/<capture_id>.jpg",
  "photo_width_px": 1600,
  "photo_height_px": 1200,
  "is_baseline": true,
  "taken_at": "2026-10-13T12:00:00Z"
}
```

Dimensions are `photo_width_px` and `photo_height_px`, matching schema.sql. They are optional positive integers. Re-captures can include `alignment_score` (0–1, up to three decimal places) and `alignment_meta` (JSON object). Baselines reject alignment data. Registration checks the key belongs to the problem and that a nonempty image/jpeg object exists. JPEG bytes/dimensions are not independently decoded. Repeating registration for an existing capture ID returns the original immutable row, so a lost mobile response can be retried safely. The DB permits at most one baseline per problem; a different capture claiming the baseline returns 409. An unused upload remains in storage; use a bucket lifecycle policy for cleanup if needed.

4. Preview: call `/problems/<id>/segment` with `{"capture_id":"<capture_id>","selection":{"x1":100,"y1":100,"x2":600,"y2":500}}`. The capture needs known dimensions. Coordinates must be integers within the prepared JPEG, with x1 < x2 and y1 < y2. Draw on a separate UI overlay; never burn brush marks into the uploaded image. For brush input, include up to 32 `points: [{x,y}]` sampled from painted foreground inside the box. Empty, fractional, excessive, or out-of-box point lists are rejected. Display the returned `mask_url` over the original and let the user repaint.

5. After explicit user confirmation, diagnose: `{"capture_id":"<capture_id>","segmentation_token":"<token from preview>","hazards":["gas"]}`. Hazard values are `gas`, `electrical_panel`, `structural_distress`, `asbestos`, and `flooding_near_electrics`.

The diagnosis provider is a constructor-injected interface token selecting mock or Meta inference. The mock produces plausible demo-shaped records, fixed pixel measurements, null mask/reference scale, and explicit mock version strings. With no reference scale, millimeter dimensions remain null and growth is unknown. A pure SafetyGate function examines explicit hazards and conservative keywords in problem/request/provider evidence; every detected safety hazard forces `safety_override=true`, `urgency=pro_now`, and `diy=null`. In mock mode no image is analyzed; Meta mode adds image-based model hazard signals from the single Muse assessment before the same deterministic gate. Keywords can conservatively over-trigger (including negated statements).

Diagnosis checks ownership and capture eligibility before inference. External calls run outside PostgreSQL transactions; then diagnosis locks the owned problem, rechecks eligibility, and creates a measurement plus report in one short transaction. A capture is measured once; concurrent/repeated diagnosis returns 409 for the loser. A failed report insert rolls back the measurement. Cached urgency and category update only when diagnosing the most recent capture. Concurrent requests can both invoke inference, but only one can commit for a capture. The latest report in problem detail is ordered by report creation time. Measurement/report write APIs are intentionally limited to this orchestration endpoint; the requested problem routes are create/read only.

Errors consistently use:

```json
{"error":{"status":400,"message":["title must be longer than or equal to 1 characters"],"path":"/problems"}}
```

`message` is a string for ordinary errors or an array for DTO validation. Unexpected errors are logged on the server and return a generic 500 message.

## Schema and migrations

The copied `sql/schema.sql` is the source of truth. Do not run it in addition to the initial migration. `synchronize` is always false.

```sh
npm run migration:run
npm run schema:check
# Dedicated development databases only; reverting deletes the initial tables/data:
npm run migration:revert
# Generate a future candidate against the current database:
npm run migration:generate -- src/database/migrations/DescribeChange
```

TypeORM generates migrations by comparing entities with a running database: https://typeorm.io/docs/migrations/generating/

The initial migration was generated against an empty PostgreSQL 17 database and reviewed against the original schema.sql. The raw generation is preserved in `migration-generation/EntityBaseline.ts.txt`. Corrections: deduplicate CREATE/DROP of shared enums, use the runtime database name in generated-column metadata, append the SQL trigger/function and demo seed, and drop shared enums after consuming tables. TypeORM additionally maintains `migrations` and `typeorm_metadata` bookkeeping tables. The initial and additive Calibration migrations are registered; the PostgreSQL 17 integration test verifies no entity drift after both.

Delta rows consider measured captures only. The calibration update adds an ID tie-breaker for equal capture timestamps and reports unknown when the previous physical area is zero. The baseline partial index ensures at most one baseline, not that a baseline must exist.

If the database already contains the original schema.sql tables, do not run the initial migration again. Run `sql/002-calibration.sql` once as `doadmin` before starting this version. Do not also apply the Calibration migration or indiscriminately fake all pending migrations: that would skip actual schema updates. Before adopting CLI migration history on a SQL-created database, reconcile the initial/Calibration history and TypeORM view/generated-column metadata with the DBA. New empty databases can use the normal migration command for both migrations.

## DigitalOcean database permissions

If `schema.sql` was applied as `doadmin`, run [sql/grant-fixlensdb.sql](sql/grant-fixlensdb.sql) once as `doadmin`, connected to that same database. Create the `fixlensdb` database user in DigitalOcean first. In a SQL editor, paste the entire script; with psql:

```sh
psql "<doadmin connection URL>" -v ON_ERROR_STOP=1 -f sql/grant-fixlensdb.sql
```

The script grants database CONNECT, schema USAGE, read access to the demo user and delta view, and read/write access to the four business tables. It also grants enum/function and sequence permissions, plus defaults for future tables/sequences/types created by `doadmin`. It is transactional and safe to rerun. It adds grants without revoking preexisting permissions, and keeps table ownership with `doadmin`; it does not change the source data model. New objects created by a different migration role need grants for that role as well.

Use the `fixlensdb` connection URL for the API's `DATABASE_URL`. Run migration/release jobs with the `doadmin` connection URL as their `DATABASE_URL`: table access grants do not authorize ALTER/DROP of admin-owned objects. The ownership-transfer comments in `schema.sql` are an alternative for making `fixlensdb` the migration owner, not a required step for the runtime grants here.

To verify, connect as `fixlensdb` and run:

```sql
SELECT current_user;
SELECT id, clerk_id FROM public.users;
SELECT * FROM public.capture_deltas LIMIT 1;
SELECT has_table_privilege(current_user, 'public.problems', 'INSERT') AS can_create_problems,
       has_table_privilege(current_user, 'public.problems', 'UPDATE') AS can_update_problems;
```

DigitalOcean documents this owner-to-runtime grant arrangement in its [PostgreSQL permissions guide](https://docs.digitalocean.com/products/databases/postgresql/how-to/modify-user-privileges/).

## Demo user and future authentication

`DemoUserGuard` injects `{id: '00000000-0000-0000-0000-000000000001'}` on every request. The migration seeds this row with `clerk_id='demo'`; the Clerk-shaped column remains solely because it exists in the SQL. There is no login, Clerk SDK, user management, or caller-controlled user ID. Services enforce ownership with the injected identity. A future auth guard can replace the APP_GUARD binding while preserving `CurrentUser` and business services. Anyone reaching the MVP API acts as the same demo user.

## Verification

```sh
npm run build
npm run lint
npm test
# Use a dedicated EMPTY database; the test applies and reverts the initial migration:
TEST_DATABASE_URL=postgresql://fixlens:fixlens@localhost:5432/fixlens_test npm run test:e2e
# PowerShell: $env:TEST_DATABASE_URL='postgresql://.../fixlens_test'; npm run test:e2e
```

Unit tests cover all safety hazards, text/provider signals, pure-function immutability, and environment validation. Integration tests use PostgreSQL and override only storage/model providers; they cover DTO errors, ownership, direct upload registration, baseline uniqueness, transaction rollback, concurrency, generated area, deltas, and migration metadata. Spaces signing is checked separately without uploading bytes; live bucket credentials are needed to verify real PUT/HEAD access.

## Real Meta inference

The existing database schema already stores all required measurement/report fields and model versions. No schema migration is required for this integration. The additional schema in `src/models/diagnosis.schema.ts` is the strict model-output JSON Schema, used both by Meta's constrained generation and local Ajv validation. Model output cannot supply IDs, storage keys, physical dimensions, or version strings.

Set these server-side variables, then restart Nest:

```dotenv
DIAGNOSIS_PROVIDER=meta
META_AI_API_KEY=<your-server-key>
META_VISION_MODEL=muse-spark-1.3
META_SAM_MODEL=sam-3.1
META_TIMEOUT_MS=90000
```

DIAGNOSIS_PROVIDER defaults to mock. Meta mode requires META_AI_API_KEY (or MODEL_API_KEY). Muse supplies the crop, spatial prompts, a short concept and preferred method in one targeting call. The API runs that one SAM method first. Only an empty/malformed result or failed geometric checks triggers the alternate method, reusing the same plan and crop. There is no separate concept-suggestion or candidate-comparison call. A normal preview takes two model calls; a completed assessment takes three including final Muse review. One fallback raises the completed flow to at most four calls. Upstream busy/timeouts do not trigger another SAM request. Unclear targeting skips SAM. Redraw reuses the upload; failed final assessment reuses its preview. Keys stay server-side.

MetaModelsService uses https://api.meta.ai/v1/responses with store:false, redirects disabled, bounded responses, no transport retries, and sanitized errors. The default timeout is 90 seconds per call (configurable 1000–90000 ms), with a shared 180-second model deadline for targeting/SAM attempts. The app allows 210 seconds for preview and 120 seconds for final assessment. Configure proxy limits accordingly. Private photo reads are separately capped at 30 seconds and 25 MiB.

### Bucket and confirmation lifecycle

Manual planar calibration accepts `known_rectangle` in addition to `reference_card`, `arkit_plane`, and `arcore_plane`. The client can enter a measured rectangle's width/height in cm, mm or inches; requests use canonical `width_mm`/`height_mm` (10–2000 mm), plus four ordered image-edge corner points. Width is corner 1→2, height is corner 2→3, and the reference must share the damage's plane. Existing photos are supported when all corners of a measurable rectangle are visible. The existing homography, bounds/convexity/horizon checks, per-pixel area integration, signed confirmation and transaction apply unchanged. Method and dimensions persist in `measurements.calibration` JSONB without a schema migration. Deltas remain conservative across different calibration methods. No physical dimensions are inferred and no additional model call is made for calibration.

Final outline review uses the original photo plus a private temporary JPEG showing the exact selected pixels as a light green tint over that same photo. The separate transparent PNG remains the authoritative stored mask; no original or accepted mask is overwritten. Raw selection/target box coordinates are omitted from final-review model evidence so a sparse branching crack is not judged as a filled rectangle. Missing scale is an independent limitation, not a mask-fidelity rejection. Overlay JPEGs are deleted after the model call (including failures). Rejected mask PNGs stay under `previews/` for the existing one-day lifecycle to permit troubleshooting; they are not promoted to measurements or permanent masks. This does not enable editing an already finalized report. No model/SQL schema change is required.

The capture screen supports **Edit highlight** (Paint / Erase / Undo, with 1×/2×/4× zoom and Move) and **Use my tracing** to bypass automatic targeting/SAM. A failed automatic preview offers **Draw my own outline**. `POST /problems/:id/mask-edits` accepts capture/selection, a `preview` or `blank` base, source-pixel strokes (paint/erase, radius, ordered points), optional calibration/hazards, and a signed `segmentation_token` when correcting a preview. The API validates ownership, photo dimensions, receipt identity/expiry and bounds; it never accepts client mask keys or counts. Limits are 64 strokes, 256 points per stroke, 8192 points total and 512 KiB JSON. Ordered raster edits are converted into a separate source-sized transparent PNG; the original JPEG stays unchanged. The returned receipt binds the new mask, geometry, hazards, calibration and `outline_source` (`sam`, `user_corrected`, `user_drawn`). Edits invoke no model APIs. The final Muse review receives this provenance and may still withhold measurements for a mismatched or unclear outline. A manually drawn region is an annotation, not a verified damage boundary.

Provenance is retained in the saved report's confidence note and the mask object's S3 `outline-source` metadata (preserved during COPY). Existing PostgreSQL `measurements`/`reports` columns store the exact accepted mask key, computed counts, calibration and assessment as before; this feature needs no schema migration. Abandoned/replaced previews use the same lifecycle cleanup below. Saving an edited preview never overwrites an earlier preview, so cancellation and failed-save retries preserve the user's work.

1. The phone prepares a JPEG, uploads directly to captures/<problem>/<capture>.jpg using a five-minute signed PUT, then registers its dimensions. API routes never proxy phone uploads/downloads. The stored original remains unmarked.

2. After validating ownership/geometry, the backend reads the private prepared JPEG (25 MiB/16 million pixels maximum), checks its dimensions/orientation, and uses sharp to create a temporary JPEG showing the user's box and sampled brush points. Muse sees the original plus these guides and the custom problem description/context. Muse grounding uses its documented normalized 0–1000 grid: the request's brush coordinates and strict response both declare this coordinate system. At the model boundary, boxes/points are converted once into the exact original photo's pixel dimensions (including non-square 1500 × 2000 photos) before overlap checks, cropping, SAM prompts, or storage. Box edges become inclusive source bounds; endpoint points are clamped to real pixels. Its response identifies a clear/unclear target, foreground points, clearly unaffected background points, and hazards. Unclear targets can proceed without SAM; invalid/off-brush geometry is rejected as a candidate. See [Meta's grounding coordinate system](https://dev.meta.ai/docs/image-understanding#coordinate-system).

3. A valid target gets 20% padding (minimum four pixels) and is cropped without resizing. SAM reads the private previews/<problem>/<capture>-<uuid>.jpg with crop-local box/foreground/negative points built by the official parser library. Concept text is never mixed with location prompts. The mask is resampled into crop bounds, then projected into the original-sized image before pixel counting or calibration. Brush/crop JPEGs are removed in finally blocks; cleanup failures are covered by the previews lifecycle rule.

4. Deterministic checks reject masks with more than 25% outside the selected box, over 85% crop coverage, or any covered Muse exclusion point. Spatial masks must cover at least 60% of foreground guides. Text masks must intersect at least one guide: text does not consume the point prompts, so a rough brush is an intent anchor rather than a ground-truth outline. Their guide-coverage fraction is retained as diagnostic data. A deterministic pass does not prove visual accuracy. The user reviews the preview and the independent final Muse assessment must accept the exact mask before measurement persistence. Limits remain: 16 million source pixels, 32 masks and 32 million cumulative raster/projected pixels per SAM response, and 8 MiB per model response.

5. POST /problems/:id/segment accepts optional context/hazards with selection/calibration and returns candidate/unavailable status, reason, target, quality, and attempt count. A 15-minute HMAC confirmation binds identity, selection, target, hazards, mask/counts, quality, and calibration; confirmations are capped at 8 KiB and signed URLs last five minutes. Candidate physical area is withheld from the preview response pending final review. Use the same random SEGMENTATION_SECRET on every replica; rotation invalidates pending previews. No new workflow schema migration or in-process preview cache is required.

6. After confirmation, Muse assesses the original with the exact candidate mask, or the original alone if no reliable segmentation exists. Its strict output has separate diagnosis and mask_review fields (matches/mismatch/unclear/unavailable). Only deterministic-pass candidates with a final matches decision are copied to permanent masks/ storage and saved as measurement/report together. Otherwise only the report is saved, with a persisted photo-based/measurements-unavailable confidence note. No zero/fake measurement row or permanent rejected mask is created. Initial/final hazards are unioned before SafetyGate. Report existence also prevents repeated photo-only diagnoses. sam_version=not-run records a skipped SAM call; spark_version identifies final Muse. Previews are deleted after confirmed commit.

Failed assessments retain the preview for retry until its confirmation expires; the original upload is reused. Expiry returns 410 and requires another preview review. Failed persistence cleans only that attempt's uncommitted permanent mask. Uncertain commits retain objects until their references can be verified. Separate concurrent attempts use distinct permanent keys and only one can commit per capture.

Configure a bucket lifecycle rule to expire **only the `previews/` prefix** after one day, covering redraws, abandoned flows, lost responses, and cleanup failures. Do not apply this rule to `captures/` or `masks/`. This project does not change bucket lifecycle rules automatically. The API key needs scoped bucket read/write access, including GET, HEAD, PUT, COPY, and DELETE. Keep objects private and use the origin S3 endpoint, reachable by Meta. Browser testing additionally needs CORS GET and PUT for the development origin; native apps do not need browser CORS.

No physical scale is inferred. Uniform scale, crack width and length stay null. Calibrated area is saved only for an accepted mask with valid planar calibration; otherwise physical area/growth are unavailable. Photo-only latest reports do not display older captures’ deltas as their own. Confidence stays 0–1 and SafetyGate still suppresses DIY for supported hazards.

Mock mode exposes the same preview/confirmation contract, but returns no real mask, fixed simulated counts, and explicit mock versions. The UI labels this preview as simulated.

```sh
npm test                       # offline model/receipt/safety tests
npm run test:e2e               # dedicated empty test DB, as described above
npm run test:meta-provider     # normally 3 model requests, max 4, synthetic JPEG, in-memory storage
npm run test:meta-api          # running Meta API + real DB/Spaces, synthetic JPEG, cleans its own objects
```

Tests cover box-prompt encoding, source-coordinate mapping, receipt tampering/identity/expiry, explicit preview confirmation, rollback, retries without repeated SAM, and real bucket COPY. Set `META_TEST_IMAGE_SIZE=1600` for the provider smoke test to exercise a larger generated image; it prints raster/bounds dimensions without exposing private images. Synthetic tests verify integration; household-photo accuracy and physical-device gesture behavior still need evaluation.

References: [Meta box and point prompts](https://dev.meta.ai/docs/sam/segmenting#prompt-with-boxes-and-points), [image inputs](https://dev.meta.ai/docs/image-understanding), [structured output](https://dev.meta.ai/docs/structured-output), and the [official parser](https://github.com/meta-models/meta-sam).

## Live Meta model smoke tests

Set `META_AI_API_KEY` in your local `.env` (or export `MODEL_API_KEY`), then run:

```sh
npm run test:models
```

This opt-in command makes three billable requests to `https://api.meta.ai/v1/responses`:

- `muse-spark-1.3`: image understanding with strict JSON output, checked against the known shape/color.
- `sam-3.1`: one box with at least 0.9 intersection-over-union against the known square, plus a nonempty mask token.
- `sam-3.1`: an absent object must complete with empty output.

Only a generated 256-by-256 PNG (red square on white) and synthetic prompts are sent.
No database, Spaces access, private photos, or additional dependencies are needed.
The key stays server-side; never place it in an `EXPO_PUBLIC_` variable.
Requests have a 90-second timeout, do not retry, and failures exit nonzero.
These tests are not part of `npm test` and do not exercise the full selectable diagnosis provider.
They establish API access and basic output compatibility, not real damage-detection accuracy,
decoded-mask correctness, physical measurements, or end-to-end diagnosis.

Docs: [Muse Spark](https://dev.meta.ai/docs/models#muse-spark),
[SAM](https://dev.meta.ai/docs/sam/overview),
[image inputs](https://dev.meta.ai/docs/image-understanding), and
[structured output](https://dev.meta.ai/docs/structured-output).

## DigitalOcean App Platform

Use `nst-fixlens` as the component source directory and the included Dockerfile (Node.js 24). Set the environment variables above, attach the managed PostgreSQL 17 connection URL, and route HTTP to PORT (default 3000). Configure `/health` as the health-check route. Run migrations once as a pre-deploy job/release step using the same image: `node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js`. Do not run migrations independently on every replica. The API binds to `0.0.0.0` and supports graceful shutdown. Infrastructure controls connection pooling; this project adds no pool tuning.

## Optional copies on the phone

The report screen provides an explicit Save photo and mask action. It does not run automatically and makes no model calls. The media endpoint verifies ownership of both problem and capture before signing the saved JPEG and the committed measurement's mask key. It returns fresh five-minute GET URLs; it never accepts a caller-supplied storage key or proxies image bytes. A missing mask is returned as null rather than invented.

The phone downloads directly from Spaces and adds two separate assets to its photo library: the unmarked assessment JPEG (the prepared upload, not the camera's full-resolution original) and the transparent source-sized SAM PNG. The PNG is a 2D segmentation mask, not a 3D mesh. Add-only photo permission is requested on tap; full gallery reading is not needed. Cache files are removed after each attempt. Known successful writes are remembered for the current screen visit, so a failed mask retry does not duplicate the JPEG. Leaving and reopening the screen resets that memory; a new intentional save can create another copy.

Web uses browser downloads, which can require allowing multiple downloads. Native Photos/gallery permission dialogs and PNG saving must be checked on an actual phone. The existing bucket copy and assessment flow is unchanged. No database migration is required.

`npm run test:media-download` checks real private JPEG/PNG downloads through the running API with synthetic data and no model calls. It removes its own test rows and objects afterward.

## Experimental segmentation comparison

`npm run test:segmentation-comparison -- path/to/manifest.json [output-directory]` makes at most six billable model requests per photo (one or two photos per run), with no model retries, database writes or bucket uploads. Each manifest item has `{name, photo, width, height, description, selection:{x1,y1,x2,y2,points:[{x,y}]}}`; `photo` is relative to the manifest. Use an already prepared JPEG and source-pixel coordinates. This command sends the selected images and descriptions to the configured Meta API; run it only with images authorized for that destination. Credentials stay in server environment variables.

Four single-attempt arms compare brush boxes/points, Muse-generated concept text on the full photo, the same concept on a brush-constrained crop, and Muse-guided spatial segmentation. Text and spatial tokens are never mixed in one SAM request, per [Meta's prompting documentation](https://dev.meta.ai/docs/sam/segmenting). The comparison remains an offline experiment; the application now uses the reviewed dynamic policy below rather than a fixed experimental arm.

The output directory contains source photos, guides, source-aligned mask PNGs, overlay JPEGs, a toggleable `index.html`, and `results.json`. Treat these local artifacts as private photos. Area, guide hits and outside-box fractions are diagnostics, not accuracy; guides may have been recreated and no ground-truth mask is assumed. Quality-check passage does not replace final visual review.

The initial two-photo run found a visibly tighter garage-crack outline with concept text (about 2.1% of photo pixels selected versus 18.8% brush-only and 11.9% Muse-guided spatial). Both text arms returned empty for the ceiling scuff; spatial methods isolated the marks. Two additional manually shortened `scuff` controls were also empty. This is an exploratory observation from two images and recreated guides, not a benchmark or justification for enabling physical measurements. The local comparison artifacts preserve all candidates; existing saved reports were unchanged.

The application default is **description + brush -> one Muse targeting/routing call -> chosen SAM method -> user confirmation/edit -> final Muse assessment**. Muse chooses text for a visibly distinct concept or spatial points for a faint/ambiguous mark, using appearance rather than a hard-coded category. Routing is a hypothesis, not an accuracy score. Failed geometric checks permit one alternate SAM attempt under the same deadline; passing geometry does not trigger a second method merely to compare results. A visually wrong but geometrically plausible mask can still be rejected by final Muse, yielding photo-only assessment and no measurements; it is not silently replaced after user confirmation. The preview returns signed `segmentation_method` and `method_selection` (routing reason and fallback flag); manual editing clears the automatic metadata. The saved report identifies the chosen automatic method. `/health` exposes `segmentation_strategy: routed-single-candidate-v1` (`mock` in demo inference mode). The separate comparison helpers remain available for offline evaluation and are not called by this request path.

## Dynamic segmentation smoke test

`npm run test:dynamic-segmentation -- path/to/manifest.json [output-directory]` uses the same manifest format for the actual routed preview provider, at most three billable calls/photo and two photos/run. It saves the selected mask/overlay locally, verifies temporary cleanup and the model-call budget, invokes no diagnosis, and makes no database or bucket writes. It sends authorized photos/derived overlays to Meta. This is an exploratory smoke test, not an accuracy benchmark; a new target plan can still contain unreliable foreground/background guides.

The capture UI's optional free-text highlight description travels in the existing `context` field on `/segment` and `/diagnose`. Muse targeting receives it as `context.observations` alongside the photo, brush, title and location. Its prompt uses descriptions to disambiguate visible marks and background exclusions; conflicting or invisible described marks must return unclear rather than forcing a mask. The final Muse assessment receives the description too. The dynamic policy needs no schema change; user descriptions remain evidence rather than trusted model instructions.

## Saved jobs and cloud cleanup

`GET /problems` excludes archived/deleting jobs and includes an optional latest-capture thumbnail URL, valid for five minutes. The response is marked `no-store`. No database migration is needed for job management.

- `GET /problems/:id/storage`: owned job's photo, saved-outline and temporary-preview counts and total bytes.
- `DELETE /problems/:id/previews`: clears only `previews/<job-id>/`, including temporary crop JPEGs. Existing highlight confirmations may need to be regenerated.
- `DELETE /problems/:id`: returns HTTP 202 with `status: deleted|deleting` and `cleanup_pending: true`. Deletes that owned job's `captures/`, `masks/` and `previews/` prefixes, then the problem row; foreign keys cascade captures, measurements and reports. Device copies are independent.

The API verifies ownership before accessing bucket content and never accepts arbitrary deletion prefixes. A private `deletions/<job-id>.json` intent stores the owner and timestamp before the job is archived. Interrupted cleanup retries every minute and survives API restarts. A final sweep after 16 minutes catches previously issued upload URLs; successful completion removes the intent. Bucket failures leave an intent for retry rather than silently orphaning files. New uploads and diagnoses reject archived jobs; in-flight model results are rechecked before persistence.

The server's Spaces key needs bucket-scoped **read/write**, including List, Get/Head, Put/Copy and Delete for these prefixes and `deletions/`. Keep all objects private. Apply the one-day expiry rule only to `previews/`; deletion intents must survive until cleanup succeeds. No bucket-wide purge endpoint is exposed. The shared demo identity means every demo client can delete the same demo jobs; replacing its guard with real authentication keeps service ownership checks intact.

With the API running, `npm run test:job-deletion` exercises real Spaces bulk deletion and preview-only cleanup using two synthetic jobs, verifies the control job survives, and removes its own fixtures. It invokes no models. Unit/integration tests additionally cover foreign ownership, partial cleanup, restart/retry, late uploads and cascading report/measurement deletion.

## Optional planar measurements

`POST /problems/:id/segment` accepts optional `calibration`: `{method, points:[{x,y},...], width_mm, height_mm}`. Methods are `reference_card`, `arkit_plane`, and `arcore_plane`. Four corners must run around the rectangle in order; the first edge corresponds to width. Points use pixel-edge coordinates in the exact prepared JPEG (0..width, 0..height), including any native rotation and upload resizing. Manual card dimensions are 85.60 × 53.98 mm. Native clients project a virtual 100 × 100 mm square on the detected plane from the captured frame's pose/intrinsics. No extra model call is needed.

The server validates finite dimensions, in-image corners, convexity, minimum visible size, and rejects a projective horizon/severe perspective across the image before inference. It derives the homography itself and sums each foreground source pixel's projected quadrilateral area. It never substitutes one global scale for a perspective transform. Geometry describes an assumed flat surface; it is not a calibrated metrology instrument, lens-distortion correction, or proof that a diffuse SAM mask accurately follows damage.

The signed preview binds calibration, transform, and computed area to the exact user/problem/capture/mask. Confirmation saves `measurements.calibration` (version, method, source dimensions, reference corners/dimensions, image-to-plane transform, `quality: approximate`) and `calibrated_area_mm2` in the existing measurement/report transaction. Mock inference does not generate calibrated metrics. Pixel area/perimeter remain in original-photo coordinates. `scale_mm_per_px`, generated `area_mm2`, crack width, and length remain null in this flow. The report endpoint now also returns `latest_measurement` for the latest report's capture; Muse receives computed area as approximate evidence and cannot invent crack dimensions.

Intentional schema extension from the originally supplied SQL: two nullable measurement columns, plus a revised `capture_deltas` view using calibrated area or legacy uniform-scale area. Mixed calibration methods, missing physical area, and zero prior area yield unknown; equal timestamps use capture IDs as a tie-breaker. Comparisons are approximate highlighted-area changes and remain sensitive to framing/segmentation. Original rows remain uncalibrated. The repo's canonical `sql/schema.sql`, entities, additive migration, and `sql/002-calibration.sql` agree. Health checks require the calibration columns, so a deployment with a missing migration stays unready.

Existing DigitalOcean database: execute `sql/002-calibration.sql` once as `doadmin` in **fixlensdb**, then restart the API. The runtime `fixlensdb` account does not own the table/view and cannot apply this change. The SQL preserves existing rows, view ownership, and view grants. New empty databases: `npm run migration:run` applies the initial and Calibration migrations. Use one upgrade route, not both. Tests cover perspective geometry, invalid references before inference, signed confirmation, persistence, growth, mixed-method rejection, migration rollback, and no entity drift.

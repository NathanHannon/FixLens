-- ============================================================
-- FixLens schema v0.1 â€” Postgres 13+
-- Conventions:
--   * Photos live in DO Spaces; the DB holds object keys only.
--   * The API (NestJS + Clerk) enforces ownership; no RLS.
--   * Physical area requires calibration or a uniform reference scale.
--     Pixel measurements alone never establish physical dimensions.
--   * Model versions are carried per row so old reports stay
--     interpretable after SAM / Spark upgrades.
-- ============================================================

-- ---------- Enums ----------

CREATE TYPE problem_category AS ENUM (
  'water_stain',
  'crack',
  'mold_mildew',
  'caulking',
  'appliance_error',
  'other'
);

CREATE TYPE problem_status AS ENUM (
  'active',      -- newly reported, no tracking cadence yet
  'monitoring',  -- on a re-capture schedule
  'resolved',
  'archived'
);

CREATE TYPE urgency AS ENUM (
  'cosmetic',
  'monitor',
  'fix_soon',
  'pro_now'
);

-- ---------- Tables ----------

-- Thin local mirror of Clerk identity; keeps FKs local and fast.
CREATE TABLE users (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id     TEXT        NOT NULL UNIQUE,
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE problems (
  id              UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT             NOT NULL,
  category        problem_category NOT NULL DEFAULT 'other',
  location_note   TEXT,                          -- e.g. "basement, north wall"
  status          problem_status   NOT NULL DEFAULT 'active',
  current_urgency urgency,                        -- cached from latest report; NULL until first diagnosis
  created_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX idx_problems_user_id ON problems(user_id);

CREATE TABLE captures (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id      UUID        NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  photo_key       TEXT        NOT NULL,   -- Spaces object key, e.g. captures/<problem_id>/<id>.jpg
  photo_width_px  INT,
  photo_height_px INT,
  is_baseline     BOOLEAN     NOT NULL DEFAULT FALSE,
  taken_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Re-capture alignment (NULL on the baseline shot)
  alignment_score NUMERIC(4,3) CHECK (alignment_score IS NULL OR (alignment_score >= 0 AND alignment_score <= 1)),
  alignment_meta  JSONB,                 -- homography / feature-match detail for debugging
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_captures_problem_taken ON captures(problem_id, taken_at);
-- Exactly one baseline per problem:
CREATE UNIQUE INDEX uq_captures_one_baseline ON captures(problem_id) WHERE is_baseline;

-- One measurement per capture: a capture is measured once.
CREATE TABLE measurements (
  id              UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id      UUID             NOT NULL UNIQUE REFERENCES captures(id) ON DELETE CASCADE,
  mask_key        TEXT,                          -- Spaces key of the SAM mask overlay PNG (NULL until segmented)
  area_px         DOUBLE PRECISION NOT NULL CHECK (area_px >= 0),
  perimeter_px    DOUBLE PRECISION CHECK (perimeter_px IS NULL OR perimeter_px >= 0),
  scale_mm_per_px DOUBLE PRECISION CHECK (scale_mm_per_px IS NULL OR scale_mm_per_px > 0),
  width_mm        DOUBLE PRECISION,              -- derived; NULL when scale unknown
  length_mm       DOUBLE PRECISION,              -- derived; NULL when scale unknown
  area_mm2        DOUBLE PRECISION GENERATED ALWAYS AS (area_px * scale_mm_per_px * scale_mm_per_px) STORED,
  calibration     JSONB,                        -- reference/AR corners, source dimensions, planar transform, approximate quality
  calibrated_area_mm2 DOUBLE PRECISION,         -- perspective-integrated area; separate from uniform-scale generated area_mm2
  sam_version     TEXT             NOT NULL,     -- model version carried per row
  measured_at     TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id              UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id      UUID             NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  capture_id      UUID             NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  verdict         TEXT             NOT NULL,     -- one line: what it is
  category        problem_category NOT NULL,
  likely_cause    TEXT,
  urgency         urgency          NOT NULL,
  confidence      NUMERIC(3,2)     NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  confidence_note TEXT,
  safety_override BOOLEAN          NOT NULL DEFAULT FALSE,  -- deterministic gate tripped: pro-only, no DIY
  diy             JSONB,                         -- {difficulty, time_estimate, steps[], parts[]}; NULL when safety_override
  pro             JSONB,                         -- {trade, what_to_tell_them}
  red_flags       TEXT[]           NOT NULL DEFAULT '{}',
  recheck_days    INT              CHECK (recheck_days IS NULL OR recheck_days > 0),
  spark_version   TEXT             NOT NULL,     -- model versions carried per row
  sam_version     TEXT             NOT NULL,
  created_at      TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_problem_id ON reports(problem_id);
CREATE INDEX idx_reports_capture_id ON reports(capture_id);

-- ---------- Housekeeping ----------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_problems_updated_at
BEFORE UPDATE ON problems
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Growth tracking ----------

-- Consecutive-capture deltas per problem. Deltas are a view, not a
-- table: always consistent, no sync jobs. Growth thresholds (Â±10%
-- area change) are a starting point â€” tune once real data exists.
CREATE VIEW capture_deltas AS
WITH ordered AS (
  SELECT
    m.*,
    COALESCE(m.calibrated_area_mm2, m.area_mm2) AS physical_area_mm2,
    c.problem_id,
    c.taken_at,
    ROW_NUMBER() OVER (PARTITION BY c.problem_id ORDER BY c.taken_at, c.id) AS rn
  FROM measurements m
  JOIN captures c ON c.id = m.capture_id
)
SELECT
  cur.problem_id,
  prev.capture_id AS from_capture_id,
  cur.capture_id  AS to_capture_id,
  EXTRACT(EPOCH FROM (cur.taken_at - prev.taken_at)) / 86400.0 AS days_between,
  CASE
    WHEN cur.physical_area_mm2 IS NULL OR prev.physical_area_mm2 IS NULL OR prev.physical_area_mm2 <= 0
      OR (cur.calibration->>'method') IS DISTINCT FROM (prev.calibration->>'method') THEN NULL
    ELSE (cur.physical_area_mm2 - prev.physical_area_mm2) / prev.physical_area_mm2 * 100
  END AS area_change_pct,
  CASE
    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN NULL
    ELSE cur.width_mm - prev.width_mm
  END AS width_change_mm,
  CASE
    WHEN cur.physical_area_mm2 IS NULL OR prev.physical_area_mm2 IS NULL OR prev.physical_area_mm2 <= 0
      OR (cur.calibration->>'method') IS DISTINCT FROM (prev.calibration->>'method') THEN 'unknown'
    WHEN (cur.physical_area_mm2 - prev.physical_area_mm2) / prev.physical_area_mm2 > 0.10 THEN 'growing'
    WHEN (cur.physical_area_mm2 - prev.physical_area_mm2) / prev.physical_area_mm2 < -0.10 THEN 'shrinking'
    ELSE 'stable'
  END AS growth
FROM ordered cur
JOIN ordered prev
  ON prev.problem_id = cur.problem_id
 AND prev.rn = cur.rn - 1;

-- ============================================================
-- Demo seed (hackathon build â€” auth deferred, see design doc)
-- The API hardcodes this UUID as the acting user until Clerk lands.
-- ============================================================
INSERT INTO users (id, clerk_id, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'demo', 'Demo User')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Ownership (only needed if you ran this file as doadmin)
-- Run as doadmin, connected to fixlensdb, then verify with:
--   SELECT tablename, tableowner FROM pg_tables WHERE schemaname='public';
-- ============================================================
-- ALTER TABLE users         OWNER TO fixlensdb;
-- ALTER TABLE problems      OWNER TO fixlensdb;
-- ALTER TABLE captures      OWNER TO fixlensdb;
-- ALTER TABLE measurements  OWNER TO fixlensdb;
-- ALTER TABLE reports        OWNER TO fixlensdb;
-- ALTER VIEW capture_deltas OWNER TO fixlensdb;
-- ALTER FUNCTION set_updated_at() OWNER TO fixlensdb;
-- ALTER TYPE problem_category OWNER TO fixlensdb;
-- ALTER TYPE problem_status   OWNER TO fixlensdb;
-- ALTER TYPE urgency          OWNER TO fixlensdb;

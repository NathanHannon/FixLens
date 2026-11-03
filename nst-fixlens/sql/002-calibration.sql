-- Existing schema.sql databases: run ONCE as the table/view owner (doadmin).
-- Do not run together with the TypeORM Calibration migration.
BEGIN;
ALTER TABLE measurements ADD COLUMN calibration jsonb, ADD COLUMN calibrated_area_mm2 double precision;
CREATE OR REPLACE VIEW capture_deltas AS WITH ordered AS (
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
DO $$ BEGIN
 IF to_regclass('public.typeorm_metadata') IS NOT NULL THEN
  UPDATE typeorm_metadata SET value='WITH ordered AS (
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
      OR (cur.calibration->>''method'') IS DISTINCT FROM (prev.calibration->>''method'') THEN NULL
    ELSE (cur.physical_area_mm2 - prev.physical_area_mm2) / prev.physical_area_mm2 * 100
  END AS area_change_pct,
  CASE
    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN NULL
    ELSE cur.width_mm - prev.width_mm
  END AS width_change_mm,
  CASE
    WHEN cur.physical_area_mm2 IS NULL OR prev.physical_area_mm2 IS NULL OR prev.physical_area_mm2 <= 0
      OR (cur.calibration->>''method'') IS DISTINCT FROM (prev.calibration->>''method'') THEN ''unknown''
    WHEN (cur.physical_area_mm2 - prev.physical_area_mm2) / prev.physical_area_mm2 > 0.10 THEN ''growing''
    WHEN (cur.physical_area_mm2 - prev.physical_area_mm2) / prev.physical_area_mm2 < -0.10 THEN ''shrinking''
    ELSE ''stable''
  END AS growth
FROM ordered cur
JOIN ordered prev
  ON prev.problem_id = cur.problem_id
 AND prev.rn = cur.rn - 1' WHERE type='VIEW' AND name='capture_deltas' AND schema='public';
 END IF;
END $$;
COMMIT;

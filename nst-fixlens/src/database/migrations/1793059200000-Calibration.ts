import type { MigrationInterface, QueryRunner } from 'typeorm';
const previous =
  "WITH ordered AS (\r\n  SELECT\r\n    m.*,\r\n    c.problem_id,\r\n    c.taken_at,\r\n    ROW_NUMBER() OVER (PARTITION BY c.problem_id ORDER BY c.taken_at) AS rn\r\n  FROM measurements m\r\n  JOIN captures c ON c.id = m.capture_id\r\n)\r\nSELECT\r\n  cur.problem_id,\r\n  prev.capture_id AS from_capture_id,\r\n  cur.capture_id  AS to_capture_id,\r\n  EXTRACT(EPOCH FROM (cur.taken_at - prev.taken_at)) / 86400.0 AS days_between,\r\n  CASE\r\n    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN NULL\r\n    ELSE (cur.area_mm2 - prev.area_mm2) / NULLIF(prev.area_mm2, 0) * 100\r\n  END AS area_change_pct,\r\n  CASE\r\n    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN NULL\r\n    ELSE cur.width_mm - prev.width_mm\r\n  END AS width_change_mm,\r\n  CASE\r\n    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN 'unknown'\r\n    WHEN (cur.area_mm2 - prev.area_mm2) / NULLIF(prev.area_mm2, 0) > 0.10 THEN 'growing'\r\n    WHEN (cur.area_mm2 - prev.area_mm2) / NULLIF(prev.area_mm2, 0) < -0.10 THEN 'shrinking'\r\n    ELSE 'stable'\r\n  END AS growth\r\nFROM ordered cur\r\nJOIN ordered prev\r\n  ON prev.problem_id = cur.problem_id\r\n AND prev.rn = cur.rn - 1";
const next =
  "WITH ordered AS (\n  SELECT\n    m.*,\n    COALESCE(m.calibrated_area_mm2, m.area_mm2) AS physical_area_mm2,\n    c.problem_id,\n    c.taken_at,\n    ROW_NUMBER() OVER (PARTITION BY c.problem_id ORDER BY c.taken_at, c.id) AS rn\n  FROM measurements m\n  JOIN captures c ON c.id = m.capture_id\n)\nSELECT\n  cur.problem_id,\n  prev.capture_id AS from_capture_id,\n  cur.capture_id  AS to_capture_id,\n  EXTRACT(EPOCH FROM (cur.taken_at - prev.taken_at)) / 86400.0 AS days_between,\n  CASE\n    WHEN cur.physical_area_mm2 IS NULL OR prev.physical_area_mm2 IS NULL OR prev.physical_area_mm2 <= 0\n      OR (cur.calibration->>'method') IS DISTINCT FROM (prev.calibration->>'method') THEN NULL\n    ELSE (cur.physical_area_mm2 - prev.physical_area_mm2) / prev.physical_area_mm2 * 100\n  END AS area_change_pct,\n  CASE\n    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN NULL\n    ELSE cur.width_mm - prev.width_mm\n  END AS width_change_mm,\n  CASE\n    WHEN cur.physical_area_mm2 IS NULL OR prev.physical_area_mm2 IS NULL OR prev.physical_area_mm2 <= 0\n      OR (cur.calibration->>'method') IS DISTINCT FROM (prev.calibration->>'method') THEN 'unknown'\n    WHEN (cur.physical_area_mm2 - prev.physical_area_mm2) / prev.physical_area_mm2 > 0.10 THEN 'growing'\n    WHEN (cur.physical_area_mm2 - prev.physical_area_mm2) / prev.physical_area_mm2 < -0.10 THEN 'shrinking'\n    ELSE 'stable'\n  END AS growth\nFROM ordered cur\nJOIN ordered prev\n  ON prev.problem_id = cur.problem_id\n AND prev.rn = cur.rn - 1";
export class Calibration1793059200000 implements MigrationInterface {
  name = 'Calibration1793059200000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE measurements ADD COLUMN calibration jsonb, ADD COLUMN calibrated_area_mm2 double precision;',
    );
    await q.query('CREATE OR REPLACE VIEW capture_deltas AS ' + next);
    await q.query(
      "UPDATE typeorm_metadata SET value=$1 WHERE type='VIEW' AND name='capture_deltas' AND schema='public'",
      [next],
    );
  }
  async down(q: QueryRunner): Promise<void> {
    // Remove dependencies on the new columns without dropping the view/grants.
    await q.query(
      'CREATE OR REPLACE VIEW capture_deltas AS ' +
        previous.replace(
          'm.*',
          'm.capture_id, m.scale_mm_per_px, m.area_mm2, m.width_mm',
        ),
    );
    await q.query(
      'ALTER TABLE measurements DROP COLUMN calibrated_area_mm2, DROP COLUMN calibration',
    );
    await q.query(
      "UPDATE typeorm_metadata SET value=$1 WHERE type='VIEW' AND name='capture_deltas' AND schema='public'",
      [previous],
    );
  }
}

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Initial1791900000000 implements MigrationInterface {
  name = 'Initial1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "clerk_id" text NOT NULL, "display_name" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "users_clerk_id_key" UNIQUE ("clerk_id"), CONSTRAINT "users_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."problem_category" AS ENUM('water_stain', 'crack', 'mold_mildew', 'caulking', 'appliance_error', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."problem_status" AS ENUM('active', 'monitoring', 'resolved', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."urgency" AS ENUM('cosmetic', 'monitor', 'fix_soon', 'pro_now')`,
    );
    await queryRunner.query(
      `CREATE TABLE "problems" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "title" text NOT NULL, "category" "public"."problem_category" NOT NULL DEFAULT 'other', "location_note" text, "status" "public"."problem_status" NOT NULL DEFAULT 'active', "current_urgency" "public"."urgency", "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resolved_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "problems_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_problems_user_id" ON "problems"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "captures" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "problem_id" uuid NOT NULL, "photo_key" text NOT NULL, "photo_width_px" integer, "photo_height_px" integer, "is_baseline" boolean NOT NULL DEFAULT FALSE, "taken_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "alignment_score" numeric(4,3), "alignment_meta" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "captures_alignment_score_check" CHECK (alignment_score IS NULL OR (alignment_score >= 0 AND alignment_score <= 1)), CONSTRAINT "captures_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_captures_one_baseline" ON "captures"  ("problem_id") WHERE is_baseline`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_captures_problem_taken" ON "captures"  ("problem_id", "taken_at") `,
    );
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        (await queryRunner.query('SELECT current_database() AS name'))[0].name,
        'public',
        'measurements',
        'GENERATED_COLUMN',
        'area_mm2',
        'area_px * scale_mm_per_px * scale_mm_per_px',
      ],
    );
    await queryRunner.query(
      `CREATE TABLE "measurements" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "capture_id" uuid NOT NULL, "mask_key" text, "area_px" double precision NOT NULL, "perimeter_px" double precision, "scale_mm_per_px" double precision, "width_mm" double precision, "length_mm" double precision, "area_mm2" double precision GENERATED ALWAYS AS (area_px * scale_mm_per_px * scale_mm_per_px) STORED, "sam_version" text NOT NULL, "measured_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "measurements_capture_id_key" UNIQUE ("capture_id"), CONSTRAINT "measurements_scale_mm_per_px_check" CHECK (scale_mm_per_px IS NULL OR scale_mm_per_px > 0), CONSTRAINT "measurements_perimeter_px_check" CHECK (perimeter_px IS NULL OR perimeter_px >= 0), CONSTRAINT "measurements_area_px_check" CHECK (area_px >= 0), CONSTRAINT "measurements_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "reports" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "problem_id" uuid NOT NULL, "capture_id" uuid NOT NULL, "verdict" text NOT NULL, "category" "public"."problem_category" NOT NULL, "likely_cause" text, "urgency" "public"."urgency" NOT NULL, "confidence" numeric(3,2) NOT NULL, "confidence_note" text, "safety_override" boolean NOT NULL DEFAULT FALSE, "diy" jsonb, "pro" jsonb, "red_flags" text array NOT NULL DEFAULT '{}', "recheck_days" integer, "spark_version" text NOT NULL, "sam_version" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "reports_recheck_days_check" CHECK (recheck_days IS NULL OR recheck_days > 0), CONSTRAINT "reports_confidence_check" CHECK (confidence >= 0 AND confidence <= 1), CONSTRAINT "reports_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_reports_capture_id" ON "reports"  ("capture_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_reports_problem_id" ON "reports"  ("problem_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "problems" ADD CONSTRAINT "problems_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "captures" ADD CONSTRAINT "captures_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "measurements" ADD CONSTRAINT "measurements_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "captures"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "reports_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "reports_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "captures"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`CREATE VIEW "capture_deltas" AS WITH ordered AS (
  SELECT
    m.*,
    c.problem_id,
    c.taken_at,
    ROW_NUMBER() OVER (PARTITION BY c.problem_id ORDER BY c.taken_at) AS rn
  FROM measurements m
  JOIN captures c ON c.id = m.capture_id
)
SELECT
  cur.problem_id,
  prev.capture_id AS from_capture_id,
  cur.capture_id  AS to_capture_id,
  EXTRACT(EPOCH FROM (cur.taken_at - prev.taken_at)) / 86400.0 AS days_between,
  CASE
    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN NULL
    ELSE (cur.area_mm2 - prev.area_mm2) / NULLIF(prev.area_mm2, 0) * 100
  END AS area_change_pct,
  CASE
    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN NULL
    ELSE cur.width_mm - prev.width_mm
  END AS width_change_mm,
  CASE
    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN 'unknown'
    WHEN (cur.area_mm2 - prev.area_mm2) / NULLIF(prev.area_mm2, 0) > 0.10 THEN 'growing'
    WHEN (cur.area_mm2 - prev.area_mm2) / NULLIF(prev.area_mm2, 0) < -0.10 THEN 'shrinking'
    ELSE 'stable'
  END AS growth
FROM ordered cur
JOIN ordered prev
  ON prev.problem_id = cur.problem_id
 AND prev.rn = cur.rn - 1`);
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (DEFAULT, $1, DEFAULT, $2, $3, $4)`,
      [
        'public',
        'VIEW',
        'capture_deltas',
        "WITH ordered AS (\n  SELECT\n    m.*,\n    c.problem_id,\n    c.taken_at,\n    ROW_NUMBER() OVER (PARTITION BY c.problem_id ORDER BY c.taken_at) AS rn\n  FROM measurements m\n  JOIN captures c ON c.id = m.capture_id\n)\nSELECT\n  cur.problem_id,\n  prev.capture_id AS from_capture_id,\n  cur.capture_id  AS to_capture_id,\n  EXTRACT(EPOCH FROM (cur.taken_at - prev.taken_at)) / 86400.0 AS days_between,\n  CASE\n    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN NULL\n    ELSE (cur.area_mm2 - prev.area_mm2) / NULLIF(prev.area_mm2, 0) * 100\n  END AS area_change_pct,\n  CASE\n    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN NULL\n    ELSE cur.width_mm - prev.width_mm\n  END AS width_change_mm,\n  CASE\n    WHEN cur.scale_mm_per_px IS NULL OR prev.scale_mm_per_px IS NULL THEN 'unknown'\n    WHEN (cur.area_mm2 - prev.area_mm2) / NULLIF(prev.area_mm2, 0) > 0.10 THEN 'growing'\n    WHEN (cur.area_mm2 - prev.area_mm2) / NULLIF(prev.area_mm2, 0) < -0.10 THEN 'shrinking'\n    ELSE 'stable'\n  END AS growth\nFROM ordered cur\nJOIN ordered prev\n  ON prev.problem_id = cur.problem_id\n AND prev.rn = cur.rn - 1",
      ],
    );
    await queryRunner.query(`CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_problems_updated_at
BEFORE UPDATE ON problems
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

`);
    await queryRunner.query(
      `INSERT INTO users (id, clerk_id, display_name) VALUES ('00000000-0000-0000-0000-000000000001', 'demo', 'Demo User') ON CONFLICT (id) DO NOTHING;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER trg_problems_updated_at ON problems; DROP FUNCTION set_updated_at();`,
    );
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "schema" = $3`,
      ['VIEW', 'capture_deltas', 'public'],
    );
    await queryRunner.query(`DROP VIEW "capture_deltas"`);
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "reports_capture_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "reports_problem_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "measurements" DROP CONSTRAINT "measurements_capture_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "captures" DROP CONSTRAINT "captures_problem_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "problems" DROP CONSTRAINT "problems_user_id_fkey"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_reports_problem_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_reports_capture_id"`);
    await queryRunner.query(`DROP TABLE "reports"`);
    await queryRunner.query(`DROP TABLE "measurements"`);
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      [
        'GENERATED_COLUMN',
        'area_mm2',
        (await queryRunner.query('SELECT current_database() AS name'))[0].name,
        'public',
        'measurements',
      ],
    );
    await queryRunner.query(`DROP INDEX "public"."idx_captures_problem_taken"`);
    await queryRunner.query(`DROP INDEX "public"."uq_captures_one_baseline"`);
    await queryRunner.query(`DROP TABLE "captures"`);
    await queryRunner.query(`DROP INDEX "public"."idx_problems_user_id"`);
    await queryRunner.query(`DROP TABLE "problems"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."urgency"`);
    await queryRunner.query(`DROP TYPE "public"."problem_category"`);
    await queryRunner.query(`DROP TYPE "public"."problem_status"`);
  }
}

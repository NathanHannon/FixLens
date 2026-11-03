import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  Check,
  ManyToOne,
  Unique,
  JoinColumn,
  ViewEntity,
  ViewColumn,
} from 'typeorm';
import { deltaExpression } from './delta-expression.js';
import type { Calibration } from '../measurements/calibration.js';
export enum ProblemCategory {
  WaterStain = 'water_stain',
  Crack = 'crack',
  MoldMildew = 'mold_mildew',
  Caulking = 'caulking',
  ApplianceError = 'appliance_error',
  Other = 'other',
}
export enum ProblemStatus {
  Active = 'active',
  Monitoring = 'monitoring',
  Resolved = 'resolved',
  Archived = 'archived',
}
export enum Urgency {
  Cosmetic = 'cosmetic',
  Monitor = 'monitor',
  FixSoon = 'fix_soon',
  ProNow = 'pro_now',
}
export interface Diy {
  difficulty: string;
  time_estimate: string;
  steps: string[];
  parts: string[];
}
export interface Pro {
  trade: string;
  what_to_tell_them: string;
}

@Entity('users')
@Unique('users_clerk_id_key', ['clerk_id'])
export class User {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'users_pkey' })
  id!: string;
  @Column({ type: 'text' })
  clerk_id!: string;
  @Column({ type: 'text', nullable: true })
  display_name!: string | null;
  @Column({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;
}

@Entity('problems')
@Index('idx_problems_user_id', ['user_id'])
export class Problem {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'problems_pkey' })
  id!: string;
  @Column({ type: 'uuid' })
  user_id!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'problems_user_id_fkey',
  })
  user!: import('typeorm').Relation<User>;
  @Column({ type: 'text' })
  title!: string;
  @Column({
    type: 'enum',
    enum: ProblemCategory,
    enumName: 'problem_category',
    default: () => "'other'",
  })
  category!: ProblemCategory;
  @Column({ type: 'text', nullable: true })
  location_note!: string | null;
  @Column({
    type: 'enum',
    enum: ProblemStatus,
    enumName: 'problem_status',
    default: () => "'active'",
  })
  status!: ProblemStatus;
  @Column({ type: 'enum', nullable: true, enum: Urgency, enumName: 'urgency' })
  current_urgency!: Urgency | null;
  @Column({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;
  @Column({ type: 'timestamptz', default: () => 'now()' })
  updated_at!: Date;
  @Column({ type: 'timestamptz', nullable: true })
  resolved_at!: Date | null;
}

@Entity('captures')
@Index('idx_captures_problem_taken', ['problem_id', 'taken_at'])
@Index('uq_captures_one_baseline', ['problem_id'], {
  unique: true,
  where: 'is_baseline',
})
@Check(
  'captures_alignment_score_check',
  'alignment_score IS NULL OR (alignment_score >= 0 AND alignment_score <= 1)',
)
export class Capture {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'captures_pkey' })
  id!: string;
  @Column({ type: 'uuid' })
  problem_id!: string;
  @ManyToOne(() => Problem, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'problem_id',
    foreignKeyConstraintName: 'captures_problem_id_fkey',
  })
  problem!: import('typeorm').Relation<Problem>;
  @Column({ type: 'text' })
  photo_key!: string;
  @Column({ type: 'integer', nullable: true })
  photo_width_px!: number | null;
  @Column({ type: 'integer', nullable: true })
  photo_height_px!: number | null;
  @Column({ type: 'boolean', default: () => 'FALSE' })
  is_baseline!: boolean;
  @Column({ type: 'timestamptz', default: () => 'now()' })
  taken_at!: Date;
  @Column({ type: 'numeric', nullable: true, precision: 4, scale: 3 })
  alignment_score!: string | null;
  @Column({ type: 'jsonb', nullable: true })
  alignment_meta!: Record<string, unknown> | null;
  @Column({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;
}

@Entity('measurements')
@Unique('measurements_capture_id_key', ['capture_id'])
@Check('measurements_area_px_check', 'area_px >= 0')
@Check(
  'measurements_perimeter_px_check',
  'perimeter_px IS NULL OR perimeter_px >= 0',
)
@Check(
  'measurements_scale_mm_per_px_check',
  'scale_mm_per_px IS NULL OR scale_mm_per_px > 0',
)
export class Measurement {
  @Column({ type: 'jsonb', nullable: true })
  calibration!: Calibration | null;
  @Column({ type: 'double precision', nullable: true })
  calibrated_area_mm2!: number | null;
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'measurements_pkey',
  })
  id!: string;
  @Column({ type: 'uuid' })
  capture_id!: string;
  @ManyToOne(() => Capture, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'capture_id',
    foreignKeyConstraintName: 'measurements_capture_id_fkey',
  })
  capture!: import('typeorm').Relation<Capture>;
  @Column({ type: 'text', nullable: true })
  mask_key!: string | null;
  @Column({ type: 'double precision' })
  area_px!: number;
  @Column({ type: 'double precision', nullable: true })
  perimeter_px!: number | null;
  @Column({ type: 'double precision', nullable: true })
  scale_mm_per_px!: number | null;
  @Column({ type: 'double precision', nullable: true })
  width_mm!: number | null;
  @Column({ type: 'double precision', nullable: true })
  length_mm!: number | null;
  @Column({
    type: 'double precision',
    nullable: true,
    asExpression: 'area_px * scale_mm_per_px * scale_mm_per_px',
    generatedType: 'STORED',
    insert: false,
    update: false,
  })
  area_mm2!: number | null;
  @Column({ type: 'text' })
  sam_version!: string;
  @Column({ type: 'timestamptz', default: () => 'now()' })
  measured_at!: Date;
}

@Entity('reports')
@Index('idx_reports_problem_id', ['problem_id'])
@Index('idx_reports_capture_id', ['capture_id'])
@Check('reports_confidence_check', 'confidence >= 0 AND confidence <= 1')
@Check('reports_recheck_days_check', 'recheck_days IS NULL OR recheck_days > 0')
export class Report {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'reports_pkey' })
  id!: string;
  @Column({ type: 'uuid' })
  problem_id!: string;
  @ManyToOne(() => Problem, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'problem_id',
    foreignKeyConstraintName: 'reports_problem_id_fkey',
  })
  problem!: import('typeorm').Relation<Problem>;
  @Column({ type: 'uuid' })
  capture_id!: string;
  @ManyToOne(() => Capture, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'capture_id',
    foreignKeyConstraintName: 'reports_capture_id_fkey',
  })
  capture!: import('typeorm').Relation<Capture>;
  @Column({ type: 'text' })
  verdict!: string;
  @Column({ type: 'enum', enum: ProblemCategory, enumName: 'problem_category' })
  category!: ProblemCategory;
  @Column({ type: 'text', nullable: true })
  likely_cause!: string | null;
  @Column({ type: 'enum', enum: Urgency, enumName: 'urgency' })
  urgency!: Urgency;
  @Column({ type: 'numeric', precision: 3, scale: 2 })
  confidence!: string;
  @Column({ type: 'text', nullable: true })
  confidence_note!: string | null;
  @Column({ type: 'boolean', default: () => 'FALSE' })
  safety_override!: boolean;
  @Column({ type: 'jsonb', nullable: true })
  diy!: Diy | null;
  @Column({ type: 'jsonb', nullable: true })
  pro!: Pro | null;
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  red_flags!: string[];
  @Column({ type: 'integer', nullable: true })
  recheck_days!: number | null;
  @Column({ type: 'text' })
  spark_version!: string;
  @Column({ type: 'text' })
  sam_version!: string;
  @Column({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;
}

@ViewEntity({ name: 'capture_deltas', expression: deltaExpression })
export class CaptureDelta {
  @ViewColumn()
  readonly problem_id!: string;
  @ViewColumn()
  readonly from_capture_id!: string;
  @ViewColumn()
  readonly to_capture_id!: string;
  @ViewColumn()
  readonly days_between!: string;
  @ViewColumn()
  readonly area_change_pct!: number | null;
  @ViewColumn()
  readonly width_change_mm!: number | null;
  @ViewColumn()
  readonly growth!: 'unknown' | 'growing' | 'shrinking' | 'stable';
}
export const entities = [
  User,
  Problem,
  Capture,
  Measurement,
  Report,
  CaptureDelta,
];

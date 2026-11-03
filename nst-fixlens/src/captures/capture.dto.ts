import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  ValidateIf,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
export class RegisterCaptureDto {
  @IsString()
  @Matches(/^captures\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/)
  photo_key!: string;
  @IsOptional() @IsInt() @Min(1) @Max(100000) photo_width_px?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100000) photo_height_px?: number;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  is_baseline?: boolean;
  @IsOptional() @IsDateString({ strict: true }) taken_at?: string;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1)
  alignment_score?: number;
  @IsOptional() @IsObject() alignment_meta?: Record<string, unknown>;
}

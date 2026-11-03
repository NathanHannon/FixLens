import {
  IsEnum,
  IsOptional,
  ValidateIf,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ProblemCategory } from '../database/entities.js';
export class CreateProblemDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(ProblemCategory)
  category?: ProblemCategory;
  @IsOptional() @IsString() @MaxLength(1000) location_note?: string;
}

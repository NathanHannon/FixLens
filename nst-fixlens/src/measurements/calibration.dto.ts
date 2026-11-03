import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { CalibrationInput } from './calibration.js';
class PointDto {
  @IsNumber({ allowInfinity: false, allowNaN: false }) @Min(0) x!: number;
  @IsNumber({ allowInfinity: false, allowNaN: false }) @Min(0) y!: number;
}
export class CalibrationDto implements CalibrationInput {
  @IsIn(['reference_card', 'known_rectangle', 'arkit_plane', 'arcore_plane'])
  method!: CalibrationInput['method'];
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  points!: PointDto[];
  @IsNumber() @Min(10) @Max(2000) width_mm!: number;
  @IsNumber() @Min(10) @Max(2000) height_mm!: number;
}

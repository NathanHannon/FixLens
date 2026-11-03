import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsUUID,
  MaxLength,
  IsString,
  IsInt,
  Min,
  ValidateNested,
  IsDefined,
  IsObject,
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsNumber,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CalibrationDto } from '../measurements/calibration.dto.js';
export enum Hazard {
  Gas = 'gas',
  ElectricalPanel = 'electrical_panel',
  StructuralDistress = 'structural_distress',
  Asbestos = 'asbestos',
  FloodingNearElectrics = 'flooding_near_electrics',
}
// Inclusive source-photo pixels, after rotation/resizing. Never screen coordinates.
export class SelectionPointDto {
  @IsInt() @Min(0) x!: number;
  @IsInt() @Min(0) y!: number;
}
export class SelectionDto {
  @IsInt() @Min(0) x1!: number;
  @IsInt() @Min(0) y1!: number;
  @IsInt() @Min(0) x2!: number;
  @IsInt() @Min(0) y2!: number;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => SelectionPointDto)
  points?: SelectionPointDto[];
}
export class SegmentDto {
  @IsOptional() @IsString() @MaxLength(2000) context?: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Hazard, { each: true })
  hazards?: Hazard[];
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CalibrationDto)
  calibration?: CalibrationDto;
  @IsUUID() capture_id!: string;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => SelectionDto)
  selection!: SelectionDto;
}
export class DiagnoseDto {
  @IsUUID() capture_id!: string;
  @IsString() @MaxLength(8192) segmentation_token!: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Hazard, { each: true })
  hazards?: Hazard[];
  @IsOptional() @IsString() @MaxLength(2000) context?: string;
}
export class MaskStrokeDto {
  @IsIn(['paint', 'erase']) mode!: 'paint' | 'erase';
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.5)
  @Max(512)
  radius!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(256)
  @ValidateNested({ each: true })
  @Type(() => SelectionPointDto)
  points!: SelectionPointDto[];
}
export class EditMaskDto extends SegmentDto {
  @IsIn(['preview', 'blank']) base!: 'preview' | 'blank';
  @IsOptional() @IsString() @MaxLength(8192) segmentation_token?: string;
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => MaskStrokeDto)
  strokes!: MaskStrokeDto[];
}

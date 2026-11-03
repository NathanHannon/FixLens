import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}
  @Get() async check() {
    try {
      await this.db.query(
        'SELECT calibration, calibrated_area_mm2 FROM measurements LIMIT 0',
      );
      return {
        status: 'ok',
        capture_flow: 'editable-outlines-v3',
        mask_review: 'pixel-shape-v4',
        calibration: 'known-rectangle-v1',
        job_deletion: 'scoped-cleanup-v1',
        segmentation_strategy:
          this.config.get<string>('DIAGNOSIS_PROVIDER') === 'meta'
            ? 'routed-single-candidate-v1'
            : 'mock',
        diagnosis_provider:
          this.config.get<string>('DIAGNOSIS_PROVIDER') ?? 'mock',
      };
    } catch {
      throw new ServiceUnavailableException(
        'Database unavailable or calibration migration missing',
      );
    }
  }
}
@Module({ controllers: [HealthController] })
export class HealthModule {}

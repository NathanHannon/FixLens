import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeasurementsModule } from '../measurements/measurements.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { DiagnosisController } from './diagnosis.controller.js';
import { DiagnosisService } from './diagnosis.service.js';
import { SafetyGate } from './safety-gate.service.js';
import {
  DIAGNOSIS_PROVIDER,
  MockDiagnosisProvider,
} from './diagnosis.provider.js';
import { ModelsModule } from '../models/models.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { MetaDiagnosisProvider } from './meta-diagnosis.provider.js';
import { MetaModelsService } from '../models/meta-models.service.js';
import { StorageService } from '../storage/storage.service.js';
import { SegmentationReceipt } from './segmentation-receipt.js';
@Module({
  imports: [MeasurementsModule, ReportsModule, ModelsModule, StorageModule],
  controllers: [DiagnosisController],
  providers: [
    DiagnosisService,
    SafetyGate,
    SegmentationReceipt,
    {
      provide: DIAGNOSIS_PROVIDER,
      inject: [ConfigService, MetaModelsService, StorageService],
      useFactory: (
        config: ConfigService,
        models: MetaModelsService,
        storage: StorageService,
      ) =>
        config.get('DIAGNOSIS_PROVIDER') === 'meta'
          ? new MetaDiagnosisProvider(models, storage)
          : new MockDiagnosisProvider(),
    },
  ],
})
export class DiagnosisModule {}

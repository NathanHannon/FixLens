import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateEnv } from './config.js';
import { buildDataSourceOptions } from './database/data-source.js';
import { DemoUserGuard } from './common/demo-user.js';
import { ProblemsModule } from './problems/problems.module.js';
import { CapturesModule } from './captures/captures.module.js';
import { MeasurementsModule } from './measurements/measurements.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { DiagnosisModule } from './diagnosis/diagnosis.module.js';
import { StorageModule } from './storage/storage.module.js';
import { HealthModule } from './health/health.module.js';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Connection options come from buildDataSourceOptions() so the Nest
    // runtime and the TypeORM CLI can never drift apart. ConfigModule
    // validates process.env first, so the factory can read it directly.
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...buildDataSourceOptions(),
        retryAttempts: 2,
      }),
    }),
    ProblemsModule,
    CapturesModule,
    MeasurementsModule,
    ReportsModule,
    DiagnosisModule,
    StorageModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: DemoUserGuard }],
})
export class AppModule { }

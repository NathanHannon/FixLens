import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Problem, Report, CaptureDelta } from '../database/entities.js';
import { ProblemsController } from './problems.controller.js';
import { ProblemsService } from './problems.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { ProblemDeletionService } from './problem-deletion.service.js';
@Module({
  imports: [
    TypeOrmModule.forFeature([Problem, Report, CaptureDelta]),
    StorageModule,
  ],
  controllers: [ProblemsController],
  providers: [ProblemsService, ProblemDeletionService],
  exports: [ProblemsService],
})
export class ProblemsModule {}

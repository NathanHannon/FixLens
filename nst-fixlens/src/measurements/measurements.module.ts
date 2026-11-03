import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Measurement } from '../database/entities.js';
@Module({
  imports: [TypeOrmModule.forFeature([Measurement])],
  exports: [TypeOrmModule],
})
export class MeasurementsModule {}

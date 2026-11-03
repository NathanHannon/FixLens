import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Report } from '../database/entities.js';
@Module({
  imports: [TypeOrmModule.forFeature([Report])],
  exports: [TypeOrmModule],
})
export class ReportsModule {}

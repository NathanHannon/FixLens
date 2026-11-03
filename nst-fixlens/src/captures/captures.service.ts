import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Capture, Measurement } from '../database/entities.js';
import { ProblemsService } from '../problems/problems.service.js';
import { StorageService } from '../storage/storage.service.js';
import { RegisterCaptureDto } from './capture.dto.js';
@Injectable()
export class CapturesService {
  constructor(
    @InjectRepository(Capture) private readonly captures: Repository<Capture>,
    @InjectRepository(Measurement)
    private readonly measurements: Repository<Measurement>,
    private readonly problems: ProblemsService,
    private readonly storage: StorageService,
  ) {}
  async media(id: string, captureId: string, userId: string) {
    await this.problems.owned(id, userId);
    const capture = await this.captures.findOneBy({
      id: captureId,
      problem_id: id,
    });
    if (!capture)
      throw new NotFoundException('Capture not found for this problem');
    const measurement = await this.measurements.findOneBy({
      capture_id: captureId,
    });
    const [photoUrl, maskUrl] = await Promise.all([
      this.storage.presignRead(capture.photo_key),
      measurement?.mask_key
        ? this.storage.presignRead(measurement.mask_key)
        : null,
    ]);
    return {
      capture_id: captureId,
      expires_in: 300,
      photo: {
        url: photoUrl,
        filename: `fixlens-${captureId}-photo.jpg`,
        content_type: 'image/jpeg',
      },
      mask: maskUrl
        ? {
            url: maskUrl,
            filename: `fixlens-${captureId}-mask.png`,
            content_type: 'image/png',
          }
        : null,
    };
  }
  async upload(id: string, userId: string) {
    id = (await this.problems.active(id, userId)).id;
    const capture_id = randomUUID();
    const photo_key = `captures/${id}/${capture_id}.jpg`;
    return {
      capture_id,
      photo_key,
      ...(await this.storage.presign(photo_key)),
    };
  }
  async register(id: string, userId: string, dto: RegisterCaptureDto) {
    id = (await this.problems.active(id, userId)).id;
    const captureId = dto.photo_key.split('/')[2]?.replace(/\.jpg$/, '');
    if (
      !captureId ||
      !isUUID(captureId) ||
      dto.photo_key !== `captures/${id}/${captureId}.jpg`
    )
      throw new BadRequestException(
        'photo_key must match this problem and contain a valid capture UUID',
      );
    if (
      dto.is_baseline &&
      (dto.alignment_score != null || dto.alignment_meta != null)
    )
      throw new BadRequestException(
        'Baseline captures cannot have alignment data',
      );
    // Mobile retries can repeat registration after the first response was lost.
    // A capture's key is immutable; return the original row rather than inserting again.
    const existing = await this.captures.findOneBy({
      id: captureId,
      problem_id: id,
    });
    if (existing) return existing;
    if (!(await this.storage.exists(dto.photo_key)))
      throw new BadRequestException(
        'Upload a non-empty JPEG before registering the capture',
      );
    return this.captures.save(
      this.captures.create({
        ...dto,
        id: captureId,
        problem_id: id,
        taken_at: dto.taken_at ? new Date(dto.taken_at) : new Date(),
        alignment_score: dto.alignment_score?.toFixed(3),
      }),
    );
  }
}

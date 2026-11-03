import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import {
  Problem,
  CaptureDelta,
  Report,
  Measurement,
  Capture,
  ProblemStatus,
} from '../database/entities.js';
import { CreateProblemDto } from './problem.dto.js';
import { StorageService } from '../storage/storage.service.js';
@Injectable()
export class ProblemsService {
  constructor(
    @InjectRepository(Problem) private readonly problems: Repository<Problem>,
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    @InjectRepository(CaptureDelta)
    private readonly deltaRows: Repository<CaptureDelta>,
    private readonly storage: StorageService,
  ) {}
  create(userId: string, dto: CreateProblemDto) {
    return this.problems.save(
      this.problems.create({ ...dto, user_id: userId }),
    );
  }
  async list(userId: string) {
    const problems = await this.problems.find({
      where: { user_id: userId, status: Not(ProblemStatus.Archived) },
      order: { created_at: 'DESC', id: 'DESC' },
    });
    if (!problems.length) return [];
    const captures = await this.problems.manager
      .getRepository(Capture)
      .createQueryBuilder('c')
      .distinctOn(['c.problem_id'])
      .where('c.problem_id IN (:...ids)', { ids: problems.map((p) => p.id) })
      .orderBy('c.problem_id')
      .addOrderBy('c.taken_at', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .getMany();
    const latest = new Map(captures.map((c) => [c.problem_id, c]));
    return Promise.all(
      problems.map(async (problem) => {
        const capture = latest.get(problem.id);
        return {
          ...problem,
          latest_capture: capture
            ? {
                id: capture.id,
                photo_url: await this.storage.presignRead(capture.photo_key),
              }
            : null,
        };
      }),
    );
  }
  async owned(id: string, userId: string) {
    const problem = await this.problems.findOneBy({ id, user_id: userId });
    if (!problem) throw new NotFoundException('Problem not found');
    return problem;
  }
  async active(id: string, userId: string) {
    const problem = await this.owned(id, userId);
    if (problem.status === ProblemStatus.Archived)
      throw new ConflictException('This job is archived or being deleted');
    return problem;
  }
  async deltas(id: string, userId: string) {
    await this.owned(id, userId);
    return this.deltaRows
      .createQueryBuilder('d')
      .innerJoin('captures', 'c', 'c.id = d.to_capture_id')
      .where('d.problem_id = :id', { id })
      .orderBy('c.taken_at', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .getMany();
  }
  async detail(id: string, userId: string) {
    const problem = await this.owned(id, userId);
    const [latest_report, deltas] = await Promise.all([
      this.reports.findOne({
        where: { problem_id: id },
        order: { created_at: 'DESC', id: 'DESC' },
      }),
      this.deltas(id, userId),
    ]);
    const latest_measurement = latest_report
      ? await this.reports.manager.findOneBy(Measurement, {
          capture_id: latest_report.capture_id,
        })
      : null;
    return {
      ...problem,
      latest_report,
      latest_measurement,
      delta_summary:
        deltas.find((d) => d.to_capture_id === latest_report?.capture_id) ??
        null,
    };
  }
}

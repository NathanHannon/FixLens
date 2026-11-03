import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Problem, ProblemStatus } from '../database/entities.js';
import {
  StorageService,
  type DeletionIntent,
} from '../storage/storage.service.js';

// A bucket intent survives App Platform restarts. Re-sweep after upload URLs,
// preview receipts, and bounded inference calls have expired before removing it.
const SETTLE_MS = 16 * 60_000;
@Injectable()
export class ProblemDeletionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProblemDeletionService.name);
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;
  constructor(
    private readonly db: DataSource,
    private readonly storage: StorageService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.sweep();
    }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async remove(id: string, userId: string) {
    id = id.toLowerCase();
    const intent = await this.db.transaction(async (manager) => {
      const problem = await manager.findOne(Problem, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (problem && problem.user_id !== userId)
        throw new NotFoundException('Job not found');
      const previous = await this.storage.deletion(id);
      if ((!problem && !previous) || (previous && previous.user_id !== userId))
        throw new NotFoundException('Job not found');
      const requested: DeletionIntent = previous ?? {
        version: 1,
        problem_id: id,
        user_id: userId,
        requested_at: Date.now(),
      };
      if (!previous) await this.storage.beginDeletion(requested);
      if (problem)
        await manager.update(Problem, id, { status: ProblemStatus.Archived });
      return requested;
    });
    try {
      await this.complete(intent);
      return { id, status: 'deleted', cleanup_pending: true };
    } catch {
      this.logger.warn(`Cleanup queued for job ${id}`);
      return { id, status: 'deleting', cleanup_pending: true };
    }
  }
  async files(id: string, userId: string) {
    await this.owned(id, userId);
    try {
      return await this.storage.problemFiles(id);
    } catch {
      throw new ServiceUnavailableException(
        'Cloud files are temporarily unavailable. Please retry.',
      );
    }
  }
  async clearPreviews(id: string, userId: string) {
    await this.owned(id, userId);
    try {
      return { removed: await this.storage.clearProblemFiles(id, true) };
    } catch {
      throw new ServiceUnavailableException(
        'Temporary file cleanup did not finish. Retry to remove any remaining previews.',
      );
    }
  }
  private async owned(id: string, userId: string) {
    const problem = await this.db
      .getRepository(Problem)
      .findOneBy({ id, user_id: userId });
    if (!problem) throw new NotFoundException('Job not found');
    if (problem.status === ProblemStatus.Archived)
      throw new ConflictException('This job is archived or being deleted');
  }
  private async complete(intent: DeletionIntent) {
    await this.db.transaction(async (manager) => {
      const problem = await manager.findOne(Problem, {
        where: { id: intent.problem_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (problem && problem.user_id !== intent.user_id)
        throw new Error('Deletion owner mismatch');
      if (problem)
        await manager.update(Problem, problem.id, {
          status: ProblemStatus.Archived,
        });
    });
    await this.storage.clearProblemFiles(intent.problem_id);
    await this.db
      .getRepository(Problem)
      .delete({ id: intent.problem_id, user_id: intent.user_id });
    if (Date.now() - intent.requested_at >= SETTLE_MS)
      await this.storage.finishDeletion(intent.problem_id);
    else if (!intent.initial_cleanup_complete)
      await this.storage.beginDeletion({
        ...intent,
        initial_cleanup_complete: true,
      });
  }
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const intent of await this.storage.pendingDeletions()) {
        if (
          intent.initial_cleanup_complete &&
          Date.now() - intent.requested_at < SETTLE_MS
        )
          continue;
        try {
          await this.complete(intent);
        } catch {
          this.logger.warn(`Retrying cleanup for job ${intent.problem_id}`);
        }
      }
    } catch {
      this.logger.warn('Cloud cleanup queue is temporarily unavailable');
    } finally {
      this.sweeping = false;
    }
  }
}

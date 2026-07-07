import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BucketsService } from '../buckets/buckets.service';
import { LifecycleService } from './lifecycle.service';

/**
 * Runs as an in-process cron job (via @nestjs/schedule) rather than a
 * BullMQ-backed processor — the HLD's original sketch assumed Redis-backed
 * queues for all async work, but a nightly sweep doesn't need a durable job
 * queue, just something that reliably fires once a day. Simpler to run and
 * to reason about for a single-instance deployment; revisit if this needs
 * to run across multiple replicas without double-processing.
 */
@Injectable()
export class LifecycleScheduler {
  private readonly logger = new Logger(LifecycleScheduler.name);

  constructor(
    private readonly bucketsService: BucketsService,
    private readonly lifecycleService: LifecycleService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runDailySweep(): Promise<void> {
    const buckets = await this.bucketsService.findAllWithLifecycleRules();
    this.logger.log(`Lifecycle sweep starting across ${buckets.length} bucket(s)`);

    for (const bucket of buckets) {
      const actions = await this.lifecycleService.evaluateRules(bucket);
      for (const action of actions) {
        if (action.type === 'EXPIRE') {
          await this.lifecycleService.applyExpiration(action.versionPk);
        } else if (action.targetStorageClass) {
          await this.lifecycleService.applyTransition(action.versionPk, action.targetStorageClass);
        }
      }
    }

    this.logger.log('Lifecycle sweep complete');
  }
}

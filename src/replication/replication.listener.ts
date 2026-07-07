import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BucketsService } from '../buckets/buckets.service';
import { ReplicationService } from './replication.service';
import { ObjectEvent } from '../notifications/event-publisher.service';

@Injectable()
export class ReplicationListener {
  private readonly logger = new Logger(ReplicationListener.name);

  constructor(
    private readonly bucketsService: BucketsService,
    private readonly replicationService: ReplicationService,
  ) {}

  @OnEvent('ObjectCreated')
  async handle(event: ObjectEvent): Promise<void> {
    const bucket = await this.bucketsService.findByName(event.bucketName);
    if (!bucket.replicationTarget) return;

    try {
      await this.replicationService.replicateObject(event.bucketName, event.key, event.versionId, bucket.replicationTarget);
    } catch (err) {
      this.logger.error(`Replication failed for ${event.bucketName}/${event.key}: ${(err as Error).message}`);
    }
  }
}

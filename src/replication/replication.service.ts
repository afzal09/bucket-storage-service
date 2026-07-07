import { Injectable, Logger } from '@nestjs/common';
import { ObjectsService } from '../objects/objects.service';

/**
 * Reuses ObjectsService.getObjectStream/putObject rather than talking to
 * StorageService directly — replication is "read the object, write it
 * somewhere else", which is exactly what those two methods already do.
 */
@Injectable()
export class ReplicationService {
  private readonly logger = new Logger(ReplicationService.name);

  constructor(private readonly objectsService: ObjectsService) {}

  async replicateObject(sourceBucket: string, key: string, versionId: string, targetBucket: string): Promise<void> {
    const { stream, version } = await this.objectsService.getObjectStream(sourceBucket, key, versionId);

    await this.objectsService.putObject(targetBucket, key, stream, {
      contentType: version.contentType,
      userMetadata: version.userMetadata || undefined,
    });

    this.logger.log(`Replicated ${sourceBucket}/${key}@${versionId} -> ${targetBucket}/${key}`);
  }
}

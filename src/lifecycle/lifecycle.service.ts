import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Bucket } from '../buckets/entities/bucket.entity';
import { ObjectRecord, ObjectVersion } from '../objects/entities/object.entity';
import { StorageService } from '../storage/storage.service';
import { LifecycleRuleDto } from '../buckets/dto/bucket.dto';

export interface LifecycleAction {
  type: 'TRANSITION' | 'EXPIRE';
  versionPk: string;
  targetStorageClass?: 'INFREQUENT_ACCESS' | 'ARCHIVE';
}

/**
 * Deliberately reads/writes ObjectRecord and ObjectVersion directly rather
 * than going through ObjectsService — keeps LifecycleModule from needing a
 * dependency on ObjectsModule (which is already in a forwardRef cycle with
 * BucketsModule and MultipartModule; no need to pull a third module in).
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    @InjectModel(ObjectRecord) private readonly objectModel: typeof ObjectRecord,
    @InjectModel(ObjectVersion) private readonly versionModel: typeof ObjectVersion,
    private readonly storageService: StorageService,
  ) {}

  async evaluateRules(bucket: Bucket): Promise<LifecycleAction[]> {
    const rules = (bucket.lifecycleRules || []) as LifecycleRuleDto[];
    const actions: LifecycleAction[] = [];
    const now = Date.now();

    for (const rule of rules) {
      const records = await this.objectModel.findAll({
        where: rule.prefix ? { bucketId: bucket.id, key: { [Op.like]: `${rule.prefix}%` } } : { bucketId: bucket.id },
        include: [ObjectVersion],
      });

      for (const record of records) {
        const latest = record.versions.find((v) => v.id === record.latestVersionId);
        if (!latest || latest.isDeleteMarker) continue;

        const ageDays = (now - new Date(latest.createdAt as any).getTime()) / (1000 * 60 * 60 * 24);

        if (rule.expireAfterDays !== undefined && ageDays >= rule.expireAfterDays) {
          actions.push({ type: 'EXPIRE', versionPk: latest.id });
        } else if (
          rule.transitionAfterDays !== undefined &&
          ageDays >= rule.transitionAfterDays &&
          latest.storageClass === 'STANDARD'
        ) {
          actions.push({ type: 'TRANSITION', versionPk: latest.id, targetStorageClass: rule.targetStorageClass });
        }
      }
    }

    return actions;
  }

  async applyTransition(versionPk: string, targetStorageClass: 'INFREQUENT_ACCESS' | 'ARCHIVE'): Promise<void> {
    const version = await this.versionModel.findByPk(versionPk);
    if (!version) return;
    await version.update({ storageClass: targetStorageClass });
    this.logger.log(`Transitioned version ${versionPk} to ${targetStorageClass}`);
    // Note: this only updates the metadata label. A backend that actually
    // has tiered storage classes (e.g. moving bytes to cheaper/slower
    // storage) would relocate the physical bytes here too.
  }

  async applyExpiration(versionPk: string): Promise<void> {
    const version = await this.versionModel.findByPk(versionPk);
    if (!version) return;

    await this.storageService.delete(version.storagePointer);
    const objectId = version.objectId;
    await version.destroy();

    const remaining = await this.versionModel.count({ where: { objectId } });
    if (remaining === 0) {
      await this.objectModel.destroy({ where: { id: objectId } });
    }
    this.logger.log(`Expired version ${versionPk}`);
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Bucket } from './entities/bucket.entity';
import { ObjectRecord } from '../objects/entities/object.entity';
import { CreateBucketDto, CorsRuleDto, EncryptionConfigDto, LifecycleRuleDto } from './dto/bucket.dto';
import {
  BucketAlreadyExistsException,
  BucketNotEmptyException,
  InvalidBucketNameException,
  NoSuchBucketException,
} from '../common/exceptions/s3.exceptions';

const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;
const IP_LIKE_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;

@Injectable()
export class BucketsService {
  constructor(
    @InjectModel(Bucket) private readonly bucketModel: typeof Bucket,
    @InjectModel(ObjectRecord) private readonly objectModel: typeof ObjectRecord,
  ) {}

  async create(name: string, dto: CreateBucketDto, ownerId: string): Promise<Bucket> {
    this.validateBucketName(name);

    const existing = await this.bucketModel.findOne({ where: { name } });
    if (existing) throw new BucketAlreadyExistsException(name);

    return this.bucketModel.create({
      name,
      region: dto.region,
      ownerId,
    } as any);
  }

  async findByName(name: string): Promise<Bucket> {
    const bucket = await this.bucketModel.findOne({ where: { name } });
    if (!bucket) throw new NoSuchBucketException(name);
    return bucket;
  }

  async findById(id: string): Promise<Bucket> {
    const bucket = await this.bucketModel.findByPk(id);
    if (!bucket) throw new NoSuchBucketException(id);
    return bucket;
  }

  async list(ownerId: string): Promise<Bucket[]> {
    return this.bucketModel.findAll({ where: { ownerId } });
  }

  /** Used by LifecycleProcessor's daily sweep — every bucket that has at least one rule configured. */
  async findAllWithLifecycleRules(): Promise<Bucket[]> {
    return this.bucketModel.findAll({ where: { lifecycleRules: { [Op.ne]: null } } });
  }

  async delete(name: string): Promise<void> {
    const bucket = await this.findByName(name);
    if (!(await this.isEmpty(bucket.id))) {
      throw new BucketNotEmptyException(name);
    }
    await bucket.destroy();
  }

  /**
   * 3–63 chars, lowercase letters/digits/hyphens, must start and end with a
   * letter or digit, and can't look like an IPv4 address — the same shape
   * S3 enforces so keys stay usable as DNS labels / virtual-hosted URLs.
   */
  validateBucketName(name: string): void {
    if (name.length < 3 || name.length > 63) {
      throw new InvalidBucketNameException('must be between 3 and 63 characters');
    }
    if (!NAME_PATTERN.test(name)) {
      throw new InvalidBucketNameException(
        'must contain only lowercase letters, numbers, and hyphens, and start/end with a letter or number',
      );
    }
    if (IP_LIKE_PATTERN.test(name)) {
      throw new InvalidBucketNameException('must not be formatted as an IP address');
    }
  }

  async setVersioning(name: string, status: 'ENABLED' | 'SUSPENDED'): Promise<Bucket> {
    const bucket = await this.findByName(name);
    return bucket.update({ versioningStatus: status });
  }

  async setLifecycleRules(name: string, rules: LifecycleRuleDto[]): Promise<Bucket> {
    const bucket = await this.findByName(name);
    return bucket.update({ lifecycleRules: rules });
  }

  async setEncryptionDefault(name: string, config: EncryptionConfigDto): Promise<Bucket> {
    const bucket = await this.findByName(name);
    return bucket.update({ defaultEncryption: config });
  }

  async setCors(name: string, rules: CorsRuleDto[]): Promise<Bucket> {
    const bucket = await this.findByName(name);
    return bucket.update({ corsConfig: rules });
  }

  private async isEmpty(bucketId: string): Promise<boolean> {
    const count = await this.objectModel.count({ where: { bucketId } });
    return count === 0;
  }
}

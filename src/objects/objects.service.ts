import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Readable } from 'stream';
import { createHash, randomUUID } from 'crypto';
import { ObjectRecord, ObjectVersion } from './entities/object.entity';
import { BucketsService } from '../buckets/buckets.service';
import { StorageService } from '../storage/storage.service';
import { EncryptionService } from '../access-control/encryption.service';
import { EventPublisherService } from '../notifications/event-publisher.service';
import { NoSuchKeyException } from '../common/exceptions/s3.exceptions';
import {
  CopyResultDto,
  DeleteResultDto,
  ListObjectsQueryDto,
  ListObjectsResultDto,
  ListVersionsResultDto,
  ObjectMetadataDto,
  PutObjectResultDto,
} from './dto/object.dto';

export interface PutObjectHeaders {
  contentType?: string;
  userMetadata?: Record<string, string>;
}

const DEFAULT_MAX_KEYS = 1000;

@Injectable()
export class ObjectsService {
  constructor(
    @InjectModel(ObjectRecord) private readonly objectModel: typeof ObjectRecord,
    @InjectModel(ObjectVersion) private readonly versionModel: typeof ObjectVersion,
    @Inject(forwardRef(() => BucketsService)) private readonly bucketsService: BucketsService,
    private readonly storageService: StorageService,
    private readonly encryptionService: EncryptionService,
    private readonly eventPublisher: EventPublisherService,
  ) {}

  async putObject(
    bucketName: string,
    key: string,
    stream: Readable,
    headers: PutObjectHeaders,
  ): Promise<PutObjectResultDto> {
    const bucket = await this.bucketsService.findByName(bucketName);
    const versionId = randomUUID();
    const pointer = this.buildStoragePointer(bucket.id, key, versionId);

    let size: number;
    let checksum: string;
    let encryptionKeyRef: string | null = null;

    if (bucket.defaultEncryption) {
      // GCM's auth tag can't be verified against an arbitrary byte range, so
      // encrypted writes are buffered whole rather than streamed through a
      // cipher. Fine for typical objects; large encrypted uploads would need
      // per-chunk envelope encryption to stay streaming-friendly.
      const plaintext = await this.bufferStream(stream);
      const { ciphertext, keyRef } = await this.encryptionService.encrypt(plaintext, bucket.defaultEncryption as any);
      encryptionKeyRef = keyRef;
      await this.storageService.write(pointer, Readable.from(ciphertext));
      size = plaintext.length;
      checksum = createHash('md5').update(plaintext).digest('hex');
    } else {
      const result = await this.storageService.write(pointer, stream);
      size = result.size;
      checksum = result.checksum;
    }

    return this.persistVersion(bucket, bucketName, key, pointer, size, checksum, headers, encryptionKeyRef);
  }

  /**
   * Used by MultipartService once parts have already been concatenated into
   * a single storage pointer — bypasses the write path above since the
   * bytes are already on disk, but ends at the same object/version rows.
   */
  async finalizeUpload(
    bucketName: string,
    key: string,
    pointer: string,
    size: number,
    checksum: string,
    headers: PutObjectHeaders,
  ): Promise<PutObjectResultDto> {
    const bucket = await this.bucketsService.findByName(bucketName);
    return this.persistVersion(bucket, bucketName, key, pointer, size, checksum, headers, null);
  }

  private async persistVersion(
    bucket: { id: string },
    bucketName: string,
    key: string,
    pointer: string,
    size: number,
    checksum: string,
    headers: PutObjectHeaders,
    encryptionKeyRef: string | null,
  ): Promise<PutObjectResultDto> {
    let objectRecord = await this.objectModel.findOne({ where: { bucketId: bucket.id, key } });
    if (!objectRecord) {
      objectRecord = await this.objectModel.create({ bucketId: bucket.id, key } as any);
    }

    const version = await this.versionModel.create({
      objectId: objectRecord.id,
      versionId: randomUUID(),
      size,
      checksum,
      storagePointer: pointer,
      contentType: headers.contentType || 'application/octet-stream',
      userMetadata: headers.userMetadata || null,
      encryptionKeyRef,
    } as any);

    await objectRecord.update({ latestVersionId: version.id, deleteMarker: false });

    await this.eventPublisher.publish({
      type: 'ObjectCreated',
      bucketName,
      key,
      versionId: version.versionId,
      size,
    });

    return { key, etag: checksum, versionId: version.versionId, size };
  }

  async getObjectStream(
    bucketName: string,
    key: string,
    versionId?: string,
    range?: { start: number; end: number },
  ): Promise<{ stream: Readable; version: ObjectVersion }> {
    const version = await this.resolveVersion(bucketName, key, versionId);

    if (version.encryptionKeyRef) {
      // Same buffering tradeoff as the write path — decrypt whole, ignore range.
      const ciphertext = await this.bufferStream(await this.storageService.read(version.storagePointer));
      const plaintext = await this.encryptionService.decrypt(ciphertext, version.encryptionKeyRef);
      return { stream: Readable.from(plaintext), version };
    }

    const stream = await this.storageService.read(version.storagePointer, range);
    return { stream, version };
  }

  async getObjectMetadata(bucketName: string, key: string, versionId?: string): Promise<ObjectVersion> {
    return this.resolveVersion(bucketName, key, versionId);
  }

  async deleteObject(bucketName: string, key: string, versionId?: string): Promise<DeleteResultDto> {
    const bucket = await this.bucketsService.findByName(bucketName);
    const objectRecord = await this.objectModel.findOne({ where: { bucketId: bucket.id, key } });
    if (!objectRecord) throw new NoSuchKeyException(key);

    if (versionId) {
      // Permanent delete of one specific version.
      const version = await this.versionModel.findOne({ where: { objectId: objectRecord.id, versionId } });
      if (!version) throw new NoSuchKeyException(key);

      if (!version.isDeleteMarker) {
        await this.storageService.delete(version.storagePointer);
      }
      await version.destroy();

      const remaining = await this.versionModel.findOne({
        where: { objectId: objectRecord.id },
        order: [['createdAt', 'DESC']],
      });
      if (remaining) {
        await objectRecord.update({ latestVersionId: remaining.id, deleteMarker: remaining.isDeleteMarker });
      } else {
        await objectRecord.destroy();
      }
      await this.eventPublisher.publish({ type: 'ObjectRemoved', bucketName, key, versionId });
      return { key, deleteMarker: false, versionId };
    }

    if (bucket.versioningStatus === 'ENABLED') {
      // Soft delete: insert a delete marker as the new latest version.
      const marker = await this.versionModel.create({
        objectId: objectRecord.id,
        versionId: randomUUID(),
        size: 0,
        checksum: '',
        storagePointer: '',
        isDeleteMarker: true,
      } as any);
      await objectRecord.update({ latestVersionId: marker.id, deleteMarker: true });
      await this.eventPublisher.publish({ type: 'ObjectRemoved', bucketName, key, versionId: marker.versionId });
      return { key, deleteMarker: true, versionId: marker.versionId };
    }

    // Versioning off/suspended: hard delete.
    const active = await this.versionModel.findByPk(objectRecord.latestVersionId);
    if (active && !active.isDeleteMarker) {
      await this.storageService.delete(active.storagePointer);
    }
    await this.versionModel.destroy({ where: { objectId: objectRecord.id } });
    await objectRecord.destroy();
    await this.eventPublisher.publish({ type: 'ObjectRemoved', bucketName, key, versionId: active?.versionId || '' });
    return { key, deleteMarker: false };
  }

  async listObjects(bucketName: string, opts: ListObjectsQueryDto): Promise<ListObjectsResultDto> {
    const bucket = await this.bucketsService.findByName(bucketName);
    const maxKeys = opts.maxKeys || DEFAULT_MAX_KEYS;

    const where: any = { bucketId: bucket.id, deleteMarker: false };
    if (opts.prefix) where.key = { [Op.like]: `${opts.prefix}%` };
    if (opts.marker) where.key = { ...(where.key || {}), [Op.gt]: opts.marker };

    const records = await this.objectModel.findAll({
      where,
      order: [['key', 'ASC']],
      limit: maxKeys + 1,
    });

    const isTruncated = records.length > maxKeys;
    const page = records.slice(0, maxKeys);

    const commonPrefixes = new Set<string>();
    const contents: ObjectMetadataDto[] = [];

    for (const record of page) {
      if (opts.delimiter) {
        const rest = record.key.slice((opts.prefix || '').length);
        const delimiterIndex = rest.indexOf(opts.delimiter);
        if (delimiterIndex !== -1) {
          commonPrefixes.add((opts.prefix || '') + rest.slice(0, delimiterIndex + opts.delimiter.length));
          continue;
        }
      }
      const version = await this.versionModel.findByPk(record.latestVersionId);
      if (version) contents.push(this.toMetadataDto(record.key, version));
    }

    return {
      bucket: bucketName,
      prefix: opts.prefix,
      delimiter: opts.delimiter,
      isTruncated,
      nextMarker: isTruncated ? page[page.length - 1]?.key : undefined,
      contents,
      commonPrefixes: [...commonPrefixes],
    };
  }

  async listObjectVersions(bucketName: string, prefix?: string): Promise<ListVersionsResultDto> {
    const bucket = await this.bucketsService.findByName(bucketName);
    const where: any = { bucketId: bucket.id };
    if (prefix) where.key = { [Op.like]: `${prefix}%` };

    const records = await this.objectModel.findAll({ where, include: [ObjectVersion], order: [['key', 'ASC']] });

    const versions: ListVersionsResultDto['versions'] = [];
    for (const record of records) {
      const sorted = [...record.versions].sort(
        (a, b) => (b.createdAt as any) - (a.createdAt as any),
      );
      for (const version of sorted) {
        versions.push({
          ...this.toMetadataDto(record.key, version),
          isLatest: version.id === record.latestVersionId,
          isDeleteMarker: version.isDeleteMarker,
        });
      }
    }

    return { bucket: bucketName, versions };
  }

  async copyObject(sourceBucket: string, sourceKey: string, destBucket: string, destKey: string): Promise<CopyResultDto> {
    const sourceVersion = await this.resolveVersion(sourceBucket, sourceKey);
    const sourceStream = await this.storageService.read(sourceVersion.storagePointer);

    const result = await this.putObject(destBucket, destKey, sourceStream, {
      contentType: sourceVersion.contentType,
      userMetadata: sourceVersion.userMetadata || undefined,
    });

    return { etag: result.etag, versionId: result.versionId, lastModified: new Date() };
  }

  async setTags(bucketName: string, key: string, tags: Record<string, string>): Promise<void> {
    const version = await this.resolveVersion(bucketName, key);
    await version.update({ tags });
  }

  async getTags(bucketName: string, key: string): Promise<Record<string, string>> {
    const version = await this.resolveVersion(bucketName, key);
    return version.tags || {};
  }

  private async resolveVersion(bucketName: string, key: string, versionId?: string): Promise<ObjectVersion> {
    const bucket = await this.bucketsService.findByName(bucketName);
    const objectRecord = await this.objectModel.findOne({ where: { bucketId: bucket.id, key } });
    if (!objectRecord) throw new NoSuchKeyException(key);

    const version = versionId
      ? await this.versionModel.findOne({ where: { objectId: objectRecord.id, versionId } })
      : await this.versionModel.findByPk(objectRecord.latestVersionId);

    if (!version || version.isDeleteMarker) throw new NoSuchKeyException(key);
    return version;
  }

  private toMetadataDto(key: string, version: ObjectVersion): ObjectMetadataDto {
    return {
      key,
      size: version.size,
      etag: version.checksum,
      contentType: version.contentType,
      versionId: version.versionId,
      storageClass: version.storageClass,
      lastModified: version.createdAt as any,
      userMetadata: version.userMetadata || {},
    };
  }

  private buildStoragePointer(bucketId: string, key: string, versionId: string): string {
    return createHash('sha256').update(`${bucketId}:${key}:${versionId}`).digest('hex');
  }

  private async bufferStream(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }
}

import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Readable } from 'stream';
import { createHash } from 'crypto';
import { MultipartUpload, MultipartPart } from './entities/multipart-upload.entity';
import { BucketsService } from '../buckets/buckets.service';
import { ObjectsService, PutObjectHeaders } from '../objects/objects.service';
import { StorageService } from '../storage/storage.service';
import { InvalidPartException, NoSuchUploadException } from '../common/exceptions/s3.exceptions';
import { PutObjectResultDto } from '../objects/dto/object.dto';

const MIN_PART_SIZE = 5 * 1024 * 1024; // 5MB, matches S3's rule (waived for the last part)

@Injectable()
export class MultipartService {
  constructor(
    @InjectModel(MultipartUpload) private readonly uploadModel: typeof MultipartUpload,
    @InjectModel(MultipartPart) private readonly partModel: typeof MultipartPart,
    private readonly bucketsService: BucketsService,
    @Inject(forwardRef(() => ObjectsService)) private readonly objectsService: ObjectsService,
    private readonly storageService: StorageService,
  ) {}

  async initiate(bucketName: string, key: string, contentType?: string): Promise<{ uploadId: string }> {
    const bucket = await this.bucketsService.findByName(bucketName);
    const upload = await this.uploadModel.create({ bucketId: bucket.id, key, contentType: contentType || null } as any);
    return { uploadId: upload.uploadId };
  }

  async storePart(uploadId: string, partNumber: number, stream: Readable): Promise<{ etag: string; size: number }> {
    const upload = await this.findUpload(uploadId);
    const pointer = this.buildPartPointer(uploadId, partNumber);

    const { size, checksum } = await this.storageService.write(pointer, stream);

    const existing = await this.partModel.findOne({ where: { uploadRecordId: upload.id, partNumber } });
    if (existing) {
      await this.storageService.delete(existing.storagePointer);
      await existing.update({ etag: checksum, size, storagePointer: pointer });
    } else {
      await this.partModel.create({
        uploadRecordId: upload.id,
        partNumber,
        etag: checksum,
        size,
        storagePointer: pointer,
      } as any);
    }

    return { etag: checksum, size };
  }

  async complete(uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<PutObjectResultDto> {
    const upload = await this.findUpload(uploadId);
    const stored = await this.partModel.findAll({ where: { uploadRecordId: upload.id }, order: [['partNumber', 'ASC']] });

    if (parts.length !== stored.length) {
      throw new InvalidPartException('Submitted part list does not match the parts actually uploaded');
    }

    const byNumber = new Map(stored.map((p) => [p.partNumber, p]));
    const orderedPointers: string[] = [];

    parts.forEach((part, index) => {
      const record = byNumber.get(part.partNumber);
      if (!record) throw new InvalidPartException(`Part ${part.partNumber} was never uploaded`);
      if (record.etag !== part.etag) throw new InvalidPartException(`ETag mismatch for part ${part.partNumber}`);
      this.validatePartSize(record.size, index === parts.length - 1);
      orderedPointers.push(record.storagePointer);
    });

    const finalPointer = this.buildPartPointer(uploadId, 'final');
    const { size, checksum } = await this.storageService.concatenateParts(orderedPointers, finalPointer);

    const headers: PutObjectHeaders = { contentType: upload.contentType || undefined };
    const result = await this.objectsService.finalizeUpload(
      await this.resolveBucketName(upload.bucketId),
      upload.key,
      finalPointer,
      size,
      checksum,
      headers,
    );

    await this.cleanupParts(upload.id, orderedPointers);
    await upload.destroy();

    return result;
  }

  async abort(uploadId: string): Promise<void> {
    const upload = await this.findUpload(uploadId);
    const parts = await this.partModel.findAll({ where: { uploadRecordId: upload.id } });
    await Promise.all(parts.map((p) => this.storageService.delete(p.storagePointer)));
    await this.partModel.destroy({ where: { uploadRecordId: upload.id } });
    await upload.destroy();
  }

  async listParts(uploadId: string): Promise<MultipartPart[]> {
    const upload = await this.findUpload(uploadId);
    return this.partModel.findAll({ where: { uploadRecordId: upload.id }, order: [['partNumber', 'ASC']] });
  }

  private validatePartSize(size: number, isLastPart: boolean): void {
    if (!isLastPart && size < MIN_PART_SIZE) {
      throw new InvalidPartException('All parts except the last must be at least 5MB');
    }
  }

  private async findUpload(uploadId: string): Promise<MultipartUpload> {
    const upload = await this.uploadModel.findOne({ where: { uploadId } });
    if (!upload) throw new NoSuchUploadException(uploadId);
    return upload;
  }

  private async resolveBucketName(bucketId: string): Promise<string> {
    const bucket = await this.bucketsService.findById(bucketId);
    return bucket.name;
  }

  private async cleanupParts(uploadRecordId: string, pointers: string[]): Promise<void> {
    await this.partModel.destroy({ where: { uploadRecordId } });
    // Individual part files were already consumed into the final concatenated
    // object by StorageService.concatenateParts — safe to remove them now.
    await Promise.all(pointers.map((p) => this.storageService.delete(p)));
  }

  private buildPartPointer(uploadId: string, part: number | 'final'): string {
    return createHash('sha256').update(`${uploadId}:part:${part}`).digest('hex');
  }
}

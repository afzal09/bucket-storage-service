import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable, PassThrough } from 'stream';
import { createHash } from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { ByteRange, StorageAdapter, WriteResult } from './storage-adapter.interface';

/**
 * Wraps an existing S3-compatible bucket (AWS S3, MinIO, etc.) as the byte
 * store, so durability/replication is inherited rather than built from
 * scratch. Same method surface as LocalDiskStorageAdapter — StorageService
 * doesn't know or care which one is bound.
 *
 * `concatenate` here does a straightforward read-then-write of each part.
 * S3 also supports UploadPartCopy for server-side part concatenation
 * without round-tripping bytes through this process — worth switching to
 * that once part sizes make the naive approach too slow.
 */
@Injectable()
export class S3CompatibleStorageAdapter implements StorageAdapter {
  private readonly logger = new Logger(S3CompatibleStorageAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const s3Config = this.config.get('storage.s3');
    this.bucket = s3Config?.bucket;
    this.client = new S3Client({
      endpoint: s3Config?.endpoint || undefined,
      region: s3Config?.region || 'us-east-1',
      forcePathStyle: !!s3Config?.endpoint, // needed for MinIO / non-AWS endpoints
      credentials: s3Config?.accessKeyId
        ? { accessKeyId: s3Config.accessKeyId, secretAccessKey: s3Config.secretAccessKey }
        : undefined,
    });
  }

  async write(pointer: string, stream: Readable): Promise<WriteResult> {
    const hash = createHash('md5');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      hash.update(chunk);
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: pointer, Body: body }),
    );

    return { size: body.length, checksum: hash.digest('hex') };
  }

  async read(pointer: string, range?: ByteRange): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: pointer,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
    );
    return result.Body as Readable;
  }

  async delete(pointer: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: pointer }));
  }

  async exists(pointer: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: pointer }));
      return true;
    } catch {
      return false;
    }
  }

  async concatenate(pointers: string[], destinationPointer: string): Promise<WriteResult> {
    const hash = createHash('md5');
    const merged = new PassThrough();
    const chunks: Buffer[] = [];
    merged.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      chunks.push(chunk);
    });

    for (const pointer of pointers) {
      const partStream = await this.read(pointer);
      await new Promise<void>((resolve, reject) => {
        partStream.on('data', (c: Buffer) => merged.write(c));
        partStream.on('end', resolve);
        partStream.on('error', reject);
      });
    }
    merged.end();

    const body = Buffer.concat(chunks);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: destinationPointer, Body: body }),
    );

    this.logger.log(`Concatenated ${pointers.length} parts into ${destinationPointer} (naive path)`);
    return { size: body.length, checksum: hash.digest('hex') };
  }
}

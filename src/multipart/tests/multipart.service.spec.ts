import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { MultipartService } from '../multipart.service';
import { LocalDiskStorageAdapter } from '../../storage/adapters/local-disk.adapter';
import { StorageService } from '../../storage/storage.service';

describe('multipart part replacement on actual local storage', () => {
  let root: string;
  let storage: StorageService;
  let adapter: LocalDiskStorageAdapter;
  let row: any;
  let parts: any;
  let upload: any;
  let objects: any;
  let service: MultipartService;
  const read = async (pointer: string) => {
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.read(pointer)) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString();
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'oss-multipart-'));
    adapter = new LocalDiskStorageAdapter(new ConfigService({ storage: { localRoot: root } }));
    storage = new StorageService(adapter);
    jest.spyOn(storage, 'write');
    row = undefined;
    upload = {
      id: 'upload-record',
      uploadId: 'public-upload',
      bucketId: 'bucket-id',
      key: 'file.txt',
      contentType: 'text/plain',
      destroy: jest.fn(),
    };
    parts = {
      findOne: jest.fn(async () => row),
      findAll: jest.fn(async () => (row ? [row] : [])),
      create: jest.fn(async (values) => {
        row = { ...values, update: jest.fn(async (next) => Object.assign(row, next)) };
        return row;
      }),
      destroy: jest.fn(async () => {
        row = undefined;
      }),
    };
    objects = {
      finalizeUpload: jest.fn(async (_bucket, key, _pointer, size, checksum) => ({
        key,
        size,
        etag: checksum,
        versionId: 'version',
      })),
    };
    service = new MultipartService(
      { findOne: jest.fn(async () => upload) } as any,
      parts,
      { findById: jest.fn(async () => ({ name: 'assets' })) } as any,
      objects,
      storage,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('replaces a part without deleting its new bytes, then completes from the replacement', async () => {
    await service.storePart('public-upload', 1, Readable.from('first'));
    const previous = row.storagePointer;
    const result = await service.storePart('public-upload', 1, Readable.from('replacement'));
    const current = row.storagePointer;
    expect(current).not.toBe(previous);
    expect(await storage.exists(previous)).toBe(false);
    expect(await read(current)).toBe('replacement');
    const complete = await service.complete('public-upload', [
      { partNumber: 1, etag: result.etag },
    ]);
    expect(complete.etag).toBe(createHash('md5').update('replacement').digest('hex'));
    expect(await read(objects.finalizeUpload.mock.calls[0][2])).toBe('replacement');
    expect(await storage.exists(current)).toBe(false);
    expect(upload.destroy).toHaveBeenCalledTimes(1);
  });

  it('preserves the old bytes and metadata when replacement metadata fails', async () => {
    await service.storePart('public-upload', 1, Readable.from('original'));
    const previous = row.storagePointer;
    row.update.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      service.storePart('public-upload', 1, Readable.from('replacement')),
    ).rejects.toThrow('database unavailable');
    expect(row.storagePointer).toBe(previous);
    expect(await read(previous)).toBe('original');
    const failedPointer = (storage.write as jest.Mock).mock.calls[1][0];
    expect(await storage.exists(failedPointer)).toBe(false);
  });

  it('cleans up bytes from a failed first-part metadata insert', async () => {
    parts.create.mockRejectedValueOnce(new Error('insert failed'));
    await expect(service.storePart('public-upload', 1, Readable.from('candidate'))).rejects.toThrow(
      'insert failed',
    );
    expect(await storage.exists((storage.write as jest.Mock).mock.calls[0][0])).toBe(false);
  });

  it('cleans up partial writes without changing an existing part', async () => {
    await service.storePart('public-upload', 1, Readable.from('original'));
    const previous = row.storagePointer;
    (storage.write as jest.Mock).mockImplementationOnce(async (pointer, stream) => {
      await adapter.write(pointer, stream);
      throw new Error('write interrupted');
    });
    await expect(service.storePart('public-upload', 1, Readable.from('partial'))).rejects.toThrow(
      'write interrupted',
    );
    expect(await read(previous)).toBe('original');
    expect(row.storagePointer).toBe(previous);
    expect(await storage.exists((storage.write as jest.Mock).mock.calls[1][0])).toBe(false);
  });

  it('never deletes the published new pointer when old-blob cleanup fails', async () => {
    await service.storePart('public-upload', 1, Readable.from('original'));
    jest.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(service.storePart('public-upload', 1, Readable.from('new bytes'))).rejects.toThrow(
      'cleanup failed',
    );
    expect(await read(row.storagePointer)).toBe('new bytes');
  });
});

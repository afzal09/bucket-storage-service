import { Inject, Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import { STORAGE_ADAPTER } from './storage.constants';
import { ByteRange, StorageAdapter, WriteResult } from './adapters/storage-adapter.interface';

/**
 * Facade in front of whichever StorageAdapter is bound to STORAGE_ADAPTER.
 * ObjectsService and MultipartService depend on this, never on a concrete
 * adapter — the Strategy/Adapter pattern from the HLD's key-decisions table.
 */
@Injectable()
export class StorageService {
  constructor(@Inject(STORAGE_ADAPTER) private readonly adapter: StorageAdapter) {}

  write(pointer: string, stream: Readable): Promise<WriteResult> {
    return this.adapter.write(pointer, stream);
  }

  read(pointer: string, range?: ByteRange): Promise<Readable> {
    return this.adapter.read(pointer, range);
  }

  delete(pointer: string): Promise<void> {
    return this.adapter.delete(pointer);
  }

  exists(pointer: string): Promise<boolean> {
    return this.adapter.exists(pointer);
  }

  concatenateParts(pointers: string[], destination: string): Promise<WriteResult> {
    return this.adapter.concatenate(pointers, destination);
  }
}

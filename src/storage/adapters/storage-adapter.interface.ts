import { Readable } from 'stream';

export interface ByteRange {
  start: number;
  end: number;
}

export interface WriteResult {
  size: number;
  checksum: string;
}

/**
 * Everything above this interface (ObjectsService, MultipartService) only
 * ever talks to StorageService, which delegates to whichever adapter is
 * bound to the STORAGE_ADAPTER token. Swapping local disk for a distributed
 * or wrapped-S3 backend means writing a new adapter, not touching callers.
 */
export interface StorageAdapter {
  write(pointer: string, stream: Readable): Promise<WriteResult>;
  read(pointer: string, range?: ByteRange): Promise<Readable>;
  delete(pointer: string): Promise<void>;
  exists(pointer: string): Promise<boolean>;
  /** Concatenates already-written part pointers (in order) into one final object at destinationPointer. */
  concatenate(pointers: string[], destinationPointer: string): Promise<WriteResult>;
}

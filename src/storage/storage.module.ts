import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { STORAGE_ADAPTER } from './storage.constants';
import { LocalDiskStorageAdapter } from './adapters/local-disk.adapter';
import { S3CompatibleStorageAdapter } from './adapters/s3-compatible.adapter';

@Module({
  imports: [ConfigModule],
  providers: [
    LocalDiskStorageAdapter,
    S3CompatibleStorageAdapter,
    {
      provide: STORAGE_ADAPTER,
      useFactory: (
        config: ConfigService,
        local: LocalDiskStorageAdapter,
        s3: S3CompatibleStorageAdapter,
      ) => (config.get('storage.adapter') === 's3' ? s3 : local),
      inject: [ConfigService, LocalDiskStorageAdapter, S3CompatibleStorageAdapter],
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}

import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { MultipartUpload, MultipartPart } from './entities/multipart-upload.entity';
import { MultipartService } from './multipart.service';
import { BucketsModule } from '../buckets/buckets.module';
import { StorageModule } from '../storage/storage.module';
import { ObjectsModule } from '../objects/objects.module';

/**
 * No controller here — multipart's HTTP surface (?uploads, ?uploadId,
 * ?partNumber) shares the exact same route space as plain object CRUD, so
 * it's dispatched from ObjectsController instead of a competing controller
 * on the same path. This module just wires up the service.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([MultipartUpload, MultipartPart]),
    forwardRef(() => BucketsModule),
    StorageModule,
    forwardRef(() => ObjectsModule),
  ],
  providers: [MultipartService],
  exports: [MultipartService],
})
export class MultipartModule {}

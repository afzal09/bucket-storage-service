import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ObjectRecord, ObjectVersion } from '../objects/entities/object.entity';
import { LifecycleService } from './lifecycle.service';
import { LifecycleScheduler } from './lifecycle.scheduler';
import { BucketsModule } from '../buckets/buckets.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [SequelizeModule.forFeature([ObjectRecord, ObjectVersion]), BucketsModule, StorageModule],
  providers: [LifecycleService, LifecycleScheduler],
  exports: [LifecycleService],
})
export class LifecycleModule {}

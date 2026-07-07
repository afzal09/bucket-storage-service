import { Module } from '@nestjs/common';
import { ReplicationService } from './replication.service';
import { ReplicationListener } from './replication.listener';
import { ObjectsModule } from '../objects/objects.module';
import { BucketsModule } from '../buckets/buckets.module';

@Module({
  imports: [ObjectsModule, BucketsModule],
  providers: [ReplicationService, ReplicationListener],
  exports: [ReplicationService],
})
export class ReplicationModule {}

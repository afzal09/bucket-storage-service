import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Bucket } from './entities/bucket.entity';
import { ObjectRecord } from '../objects/entities/object.entity';
import { BucketsController } from './buckets.controller';
import { BucketsService } from './buckets.service';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { ObjectsModule } from '../objects/objects.module';

@Module({
  imports: [
    SequelizeModule.forFeature([Bucket, ObjectRecord]),
    AccessControlModule,
    AuthModule,
    forwardRef(() => ObjectsModule),
  ],
  controllers: [BucketsController],
  providers: [BucketsService],
  exports: [BucketsService],
})
export class BucketsModule {}

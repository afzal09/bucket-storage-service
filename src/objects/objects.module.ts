import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ObjectRecord, ObjectVersion } from './entities/object.entity';
import { ObjectsController } from './objects.controller';
import { ObjectsService } from './objects.service';
import { StorageModule } from '../storage/storage.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { BucketsModule } from '../buckets/buckets.module';
import { MultipartModule } from '../multipart/multipart.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    SequelizeModule.forFeature([ObjectRecord, ObjectVersion]),
    StorageModule,
    AccessControlModule,
    AuthModule,
    NotificationsModule,
    forwardRef(() => BucketsModule),
    forwardRef(() => MultipartModule),
  ],
  controllers: [ObjectsController],
  providers: [ObjectsService],
  exports: [ObjectsService],
})
export class ObjectsModule {}

import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Policy } from './entities/policy.entity';
import { PolicyService } from './policy.service';
import { EncryptionService } from './encryption.service';
import { PresignedUrlService } from './presigned-url.service';

@Module({
  imports: [SequelizeModule.forFeature([Policy])],
  providers: [PolicyService, EncryptionService, PresignedUrlService],
  exports: [PolicyService, EncryptionService, PresignedUrlService],
})
export class AccessControlModule {}

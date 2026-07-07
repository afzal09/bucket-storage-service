import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AccessKey } from './entities/access-key.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SignatureGuard } from './guards/signature.guard';
import { AccessControlModule } from '../access-control/access-control.module';

@Module({
  imports: [SequelizeModule.forFeature([AccessKey]), AccessControlModule],
  controllers: [AuthController],
  providers: [AuthService, SignatureGuard],
  exports: [AuthService, SignatureGuard],
})
export class AuthModule {}

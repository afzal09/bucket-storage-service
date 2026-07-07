import { IsString } from 'class-validator';

export class CreateAccessKeyDto {
  @IsString()
  ownerId: string;
}

export class AccessKeyDto {
  accessKeyId: string;
  secretKey: string;
}

import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateBucketDto {
  @IsString()
  region: string;
}

export class BucketPolicyStatementDto {
  @IsString()
  principal: string; // '*' or a specific ownerId

  @IsString()
  action: string; // '*' or e.g. 'GetObject'

  @IsOptional()
  @IsString()
  resourcePattern?: string; // defaults to '<bucket>/*' if omitted

  @IsIn(['ALLOW', 'DENY'])
  effect: 'ALLOW' | 'DENY';
}

export class BucketPolicyDto {
  statements: BucketPolicyStatementDto[];
}

export class LifecycleRuleDto {
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  transitionAfterDays?: number;

  @IsOptional()
  @IsIn(['INFREQUENT_ACCESS', 'ARCHIVE'])
  targetStorageClass?: 'INFREQUENT_ACCESS' | 'ARCHIVE';

  @IsOptional()
  expireAfterDays?: number;
}

export class EncryptionConfigDto {
  @IsIn(['SSE_S3', 'SSE_KMS'])
  algorithm: 'SSE_S3' | 'SSE_KMS';

  @IsOptional()
  @IsString()
  kmsKeyId?: string;
}

export class CorsRuleDto {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders?: string[];
}

export class VersioningConfigDto {
  @IsIn(['ENABLED', 'SUSPENDED'])
  status: 'ENABLED' | 'SUSPENDED';
}

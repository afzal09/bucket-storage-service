import { IsOptional, IsString } from 'class-validator';

export class ListObjectsQueryDto {
  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  @IsString()
  delimiter?: string;

  @IsOptional()
  @IsString()
  marker?: string;

  @IsOptional()
  maxKeys?: number;
}

export class TagSetDto {
  tags: Record<string, string>;
}

export interface PutObjectResultDto {
  key: string;
  etag: string;
  versionId: string;
  size: number;
}

export interface DeleteResultDto {
  key: string;
  deleteMarker: boolean;
  versionId?: string;
}

export interface ObjectMetadataDto {
  key: string;
  size: number;
  etag: string;
  contentType: string;
  versionId: string;
  storageClass: string;
  lastModified: Date;
  userMetadata: Record<string, string>;
}

export interface ListObjectsResultDto {
  bucket: string;
  prefix?: string;
  delimiter?: string;
  isTruncated: boolean;
  nextMarker?: string;
  contents: ObjectMetadataDto[];
  commonPrefixes: string[];
}

export interface ListVersionsResultDto {
  bucket: string;
  versions: (ObjectMetadataDto & { isLatest: boolean; isDeleteMarker: boolean })[];
}

export interface CopyResultDto {
  etag: string;
  versionId: string;
  lastModified: Date;
}

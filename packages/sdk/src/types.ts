import type { Readable } from 'node:stream';

export interface ClientOptions {
  /** Server origin, e.g. http://localhost:4000. Path prefixes are not supported. */
  endpoint: string;
  accessKeyId?: string;
  secretKey?: string;
  /** Optional compatible transport for instrumentation/testing. */
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  signal?: AbortSignal;
}
export interface BucketInput extends RequestOptions {
  bucket: string;
}
export interface ObjectInput extends BucketInput {
  key: string;
}
export interface VersionInput extends ObjectInput {
  versionId?: string;
}
export type UploadBody =
  | string
  | Uint8Array
  | Readable
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>;
export type StringMap = Record<string, string>;
export type StorageClass = 'STANDARD' | 'INFREQUENT_ACCESS' | 'ARCHIVE';
export type VersioningStatus = 'DISABLED' | 'ENABLED' | 'SUSPENDED';
export interface AccessKey {
  accessKeyId: string;
  secretKey: string;
}
export interface EncryptionConfig {
  algorithm: 'SSE_S3' | 'SSE_KMS';
  kmsKeyId?: string;
}
export interface LifecycleRule {
  id: string;
  prefix?: string;
  transitionAfterDays?: number;
  targetStorageClass?: 'INFREQUENT_ACCESS' | 'ARCHIVE';
  expireAfterDays?: number;
}
export interface CorsRule {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders?: string[];
}
export interface Bucket {
  id: string;
  name: string;
  region: string;
  ownerId: string;
  versioningStatus: VersioningStatus;
  defaultEncryption: EncryptionConfig | null;
  lifecycleRules: LifecycleRule[] | null;
  corsConfig: CorsRule[] | null;
  replicationTarget: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PolicyStatement {
  principal: string;
  action: string;
  resourcePattern?: string;
  effect: 'ALLOW' | 'DENY';
}
export interface PolicyRow extends Omit<PolicyStatement, 'resourcePattern'> {
  id: string;
  bucketName: string;
  resourcePattern: string;
  createdAt: string;
  updatedAt: string;
}
export interface PutResult {
  key: string;
  etag: string;
  versionId: string;
  size: number;
}
export interface DeleteResult {
  key: string;
  deleteMarker: boolean;
  versionId?: string;
}
export interface CopyResult {
  etag: string;
  versionId: string;
  lastModified: string;
}
export interface ObjectMetadata {
  key: string;
  size: number | string;
  etag: string;
  contentType: string;
  versionId: string;
  storageClass: StorageClass;
  lastModified: string;
  userMetadata: StringMap;
}
export interface VersionMetadata extends ObjectMetadata {
  isLatest: boolean;
  isDeleteMarker: boolean;
}
export interface ListObjectsResult {
  bucket: string;
  prefix?: string;
  delimiter?: string;
  isTruncated: boolean;
  nextMarker?: string;
  contents: ObjectMetadata[];
  commonPrefixes: string[];
}
export interface ListVersionsResult {
  bucket: string;
  versions: VersionMetadata[];
}
export interface DownloadResult {
  body: Readable;
  status: number;
  contentType?: string;
  /** Header text is preserved to avoid rounding a large byte count. */
  contentLength?: string;
  etag?: string;
  versionId?: string;
  requestId?: string;
}
export type HeadResult = Omit<DownloadResult, 'body'>;
export interface UploadInput extends ObjectInput {
  body: UploadBody;
  contentType?: string;
  userMetadata?: StringMap;
}
export interface DownloadInput extends VersionInput {
  range?: { start: number; end?: number };
}
export interface ListObjectsInput extends BucketInput {
  prefix?: string;
  delimiter?: string;
  marker?: string;
  // maxKeys is intentionally absent until the server converts HTTP query values.
}
export interface UploadSessionInput extends ObjectInput {
  uploadId: string;
}
export interface CompletedPart {
  partNumber: number;
  etag: string;
}
export interface PartRow extends CompletedPart {
  id: string;
  uploadRecordId: string;
  size: number | string;
  storagePointer: string;
  createdAt: string;
  updatedAt: string;
}

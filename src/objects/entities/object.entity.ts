import { BelongsTo, Column, DataType, ForeignKey, HasMany, Model, Table } from 'sequelize-typescript';
import { Bucket } from '../../buckets/entities/bucket.entity';

@Table({ tableName: 'objects', timestamps: true, indexes: [{ unique: true, fields: ['bucketId', 'key'] }] })
export class ObjectRecord extends Model<ObjectRecord> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  id: string;

  @ForeignKey(() => Bucket)
  @Column({ type: DataType.UUID, allowNull: false })
  bucketId: string;

  @BelongsTo(() => Bucket)
  bucket: Bucket;

  @Column({ type: DataType.STRING, allowNull: false })
  key: string;

  @Column({ type: DataType.UUID, allowNull: true })
  latestVersionId: string | null;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  deleteMarker: boolean;

  @HasMany(() => ObjectVersion)
  versions: ObjectVersion[];
}

@Table({ tableName: 'object_versions', timestamps: true })
export class ObjectVersion extends Model<ObjectVersion> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  id: string;

  @ForeignKey(() => ObjectRecord)
  @Column({ type: DataType.UUID, allowNull: false })
  objectId: string;

  @BelongsTo(() => ObjectRecord)
  object: ObjectRecord;

  /** Human-facing version identifier (distinct from the internal `id` PK). */
  @Column({ type: DataType.STRING, allowNull: false, defaultValue: DataType.UUIDV4 })
  versionId: string;

  @Column({ type: DataType.BIGINT, allowNull: false })
  size: number;

  @Column({ type: DataType.STRING, allowNull: false })
  checksum: string;

  /** Points into whatever StorageAdapter is active — see storage/adapters. */
  @Column({ type: DataType.STRING, allowNull: false })
  storagePointer: string;

  @Column({ type: DataType.ENUM('STANDARD', 'INFREQUENT_ACCESS', 'ARCHIVE'), defaultValue: 'STANDARD' })
  storageClass: 'STANDARD' | 'INFREQUENT_ACCESS' | 'ARCHIVE';

  @Column({ type: DataType.STRING, defaultValue: 'application/octet-stream' })
  contentType: string;

  @Column({ type: DataType.JSON, allowNull: true })
  userMetadata: Record<string, string> | null;

  @Column({ type: DataType.JSON, allowNull: true })
  tags: Record<string, string> | null;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  isDeleteMarker: boolean;

  /** Present only when defaultEncryption was set on the bucket at write time. */
  @Column({ type: DataType.STRING, allowNull: true })
  encryptionKeyRef: string | null;
}

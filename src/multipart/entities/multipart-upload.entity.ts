import { BelongsTo, Column, DataType, ForeignKey, HasMany, Model, Table } from 'sequelize-typescript';
import { Bucket } from '../../buckets/entities/bucket.entity';

@Table({ tableName: 'multipart_uploads', timestamps: true })
export class MultipartUpload extends Model<MultipartUpload> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  id: string;

  @ForeignKey(() => Bucket)
  @Column({ type: DataType.UUID, allowNull: false })
  bucketId: string;

  @Column({ type: DataType.STRING, allowNull: false })
  key: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true, defaultValue: DataType.UUIDV4 })
  uploadId: string;

  @Column({ type: DataType.STRING, allowNull: true })
  contentType: string | null;

  @HasMany(() => MultipartPart)
  parts: MultipartPart[];
}

@Table({ tableName: 'multipart_parts', timestamps: true, indexes: [{ unique: true, fields: ['uploadRecordId', 'partNumber'] }] })
export class MultipartPart extends Model<MultipartPart> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  id: string;

  @ForeignKey(() => MultipartUpload)
  @Column({ type: DataType.UUID, allowNull: false })
  uploadRecordId: string;

  @BelongsTo(() => MultipartUpload)
  upload: MultipartUpload;

  @Column({ type: DataType.INTEGER, allowNull: false })
  partNumber: number;

  @Column({ type: DataType.STRING, allowNull: false })
  etag: string;

  @Column({ type: DataType.BIGINT, allowNull: false })
  size: number;

  @Column({ type: DataType.STRING, allowNull: false })
  storagePointer: string;
}

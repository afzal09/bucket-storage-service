import { Column, DataType, HasMany, Model, Table } from 'sequelize-typescript';
import { ObjectRecord } from '../../objects/entities/object.entity';

@Table({ tableName: 'buckets', timestamps: true })
export class Bucket extends Model<Bucket> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  name: string;

  @Column({ type: DataType.STRING, allowNull: false })
  region: string;

  @Column({ type: DataType.STRING, allowNull: false })
  ownerId: string;

  @Column({ type: DataType.ENUM('DISABLED', 'ENABLED', 'SUSPENDED'), defaultValue: 'DISABLED' })
  versioningStatus: 'DISABLED' | 'ENABLED' | 'SUSPENDED';

  @Column({ type: DataType.JSON, allowNull: true })
  defaultEncryption: Record<string, any> | null;

  @Column({ type: DataType.JSON, allowNull: true })
  lifecycleRules: Record<string, any>[] | null;

  @Column({ type: DataType.JSON, allowNull: true })
  corsConfig: Record<string, any>[] | null;

  /** Bucket name to replicate every new object into, or null for no replication. */
  @Column({ type: DataType.STRING, allowNull: true })
  replicationTarget: string | null;

  @HasMany(() => ObjectRecord)
  objects: ObjectRecord[];
}

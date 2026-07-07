import { Column, DataType, Model, Table } from 'sequelize-typescript';

/**
 * Deliberately keyed by bucketName rather than a bucketId foreign key.
 * A real FK would force AccessControlModule to import BucketsModule (and
 * vice versa, since BucketsService needs PolicyService for ?policy support)
 * — a cycle. Bucket names are already globally unique, so the denormalized
 * key is a fair trade for keeping the two modules independent.
 */
@Table({ tableName: 'policies', timestamps: true })
export class Policy extends Model<Policy> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  bucketName: string;

  /** '*' or a specific ownerId */
  @Column({ type: DataType.STRING, allowNull: false })
  principal: string;

  /** '*' or a specific action, e.g. 'GetObject', 'PutObject' */
  @Column({ type: DataType.STRING, allowNull: false })
  action: string;

  /** e.g. 'my-bucket/*' or 'my-bucket/invoices/*' */
  @Column({ type: DataType.STRING, allowNull: false })
  resourcePattern: string;

  @Column({ type: DataType.ENUM('ALLOW', 'DENY'), defaultValue: 'ALLOW' })
  effect: 'ALLOW' | 'DENY';
}

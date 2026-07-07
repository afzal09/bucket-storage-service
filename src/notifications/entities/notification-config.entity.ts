import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'notification_configs', timestamps: true })
export class NotificationConfig extends Model<NotificationConfig> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  bucketName: string;

  /** e.g. ['ObjectCreated', 'ObjectRemoved'] */
  @Column({ type: DataType.JSON, allowNull: false })
  events: string[];

  @Column({ type: DataType.STRING, allowNull: false })
  webhookUrl: string;
}

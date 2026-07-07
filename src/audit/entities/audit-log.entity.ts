import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'audit_logs', timestamps: true })
export class AuditLog extends Model<AuditLog> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  actor: string;

  @Column({ type: DataType.STRING, allowNull: false })
  action: string;

  @Column({ type: DataType.STRING, allowNull: false })
  resource: string;

  @Column({ type: DataType.ENUM('SUCCESS', 'DENIED', 'ERROR'), allowNull: false })
  result: 'SUCCESS' | 'DENIED' | 'ERROR';

  @Column({ type: DataType.STRING, allowNull: true })
  requestId: string | null;
}

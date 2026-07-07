import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'access_keys', timestamps: true })
export class AccessKey extends Model<AccessKey> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  ownerId: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  accessKeyId: string;

  /**
   * Encrypted (not hashed) via EncryptionService.encryptWithMasterKey.
   * HMAC signature verification is symmetric — the server needs the raw
   * secret back to recompute the client's signature, so a one-way hash
   * (as the original LLD sketch had) can't work here the way a login
   * password hash would.
   */
  @Column({ type: DataType.TEXT, allowNull: false })
  secretKeyEncrypted: string;

  @Column({ type: DataType.BOOLEAN, defaultValue: true })
  active: boolean;
}

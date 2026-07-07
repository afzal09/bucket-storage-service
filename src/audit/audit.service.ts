import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditLog) private readonly auditLogModel: typeof AuditLog) {}

  async log(
    actor: string,
    action: string,
    resource: string,
    result: 'SUCCESS' | 'DENIED' | 'ERROR',
    requestId?: string,
  ): Promise<void> {
    await this.auditLogModel.create({ actor, action, resource, result, requestId: requestId || null } as any);
  }
}

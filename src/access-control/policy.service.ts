import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Policy } from './entities/policy.entity';
import { Principal } from '../common/interfaces/principal.interface';
import { BucketPolicyDto } from '../buckets/dto/bucket.dto';

@Injectable()
export class PolicyService {
  constructor(@InjectModel(Policy) private readonly policyModel: typeof Policy) {}

  /**
   * Owner (or root) requests are always allowed and never touch the policy
   * table — bucketOwnerId is passed in by the caller (BucketsService /
   * ObjectsService), which already loaded the bucket and knows its owner.
   * Non-owners are evaluated against explicit statements; an explicit DENY
   * anywhere short-circuits to false, matching S3's evaluation order.
   */
  async evaluate(
    principal: Principal,
    action: string,
    resource: string,
    bucketOwnerId?: string,
  ): Promise<boolean> {
    if (principal.isRoot || (bucketOwnerId && principal.ownerId === bucketOwnerId)) {
      return true;
    }

    const bucketName = resource.split('/')[0];
    const policies = await this.policyModel.findAll({ where: { bucketName } });

    let allowed = false;
    for (const policy of policies) {
      if (!this.matchesPrincipal(policy.principal, principal)) continue;
      if (!this.matchesAction(policy.action, action)) continue;
      if (!this.matchesResource(policy.resourcePattern, resource)) continue;

      if (policy.effect === 'DENY') return false;
      allowed = true;
    }
    return allowed;
  }

  async attachBucketPolicy(bucketName: string, policy: BucketPolicyDto): Promise<void> {
    await this.policyModel.destroy({ where: { bucketName } });
    await this.policyModel.bulkCreate(
      policy.statements.map((statement) => ({
        bucketName,
        principal: statement.principal,
        action: statement.action,
        resourcePattern: statement.resourcePattern ?? `${bucketName}/*`,
        effect: statement.effect,
      })),
    );
  }

  async getEffectivePolicy(bucketName: string): Promise<Policy[]> {
    return this.policyModel.findAll({ where: { bucketName } });
  }

  private matchesPrincipal(pattern: string, principal: Principal): boolean {
    return pattern === '*' || pattern === principal.ownerId;
  }

  private matchesAction(pattern: string, action: string): boolean {
    return pattern === '*' || pattern === action;
  }

  private matchesResource(pattern: string, resource: string): boolean {
    const regex = new RegExp('^' + pattern.split('*').map(this.escapeRegex).join('.*') + '$');
    return regex.test(resource);
  }

  private escapeRegex(segment: string): string {
    return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
}

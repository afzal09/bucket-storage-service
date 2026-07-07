import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Put,
  Query,
  UseGuards,
  forwardRef,
} from '@nestjs/common';
import { BucketsService } from './buckets.service';
import { PolicyService } from '../access-control/policy.service';
import { SignatureGuard } from '../auth/guards/signature.guard';
import { CurrentPrincipal } from '../common/decorators/current-principal.decorator';
import { Principal } from '../common/interfaces/principal.interface';
import {
  BucketPolicyDto,
  CorsRuleDto,
  CreateBucketDto,
  EncryptionConfigDto,
  LifecycleRuleDto,
  VersioningConfigDto,
} from './dto/bucket.dto';
import { ObjectsService } from '../objects/objects.service';

/**
 * Owns every route rooted at `/:bucket` with no object key. NestJS routes on
 * method + path, not query string, so S3's overloaded subresource
 * convention (?policy, ?versioning, ?lifecycle, ?encryption, ?cors,
 * ?versions) is handled here as a single method per verb that dispatches
 * internally — seven separate @Put(':bucket') decorators would collide.
 *
 * Depends on ObjectsService (via forwardRef, since ObjectsModule also
 * depends on BucketsModule) purely for the GET fallback: a bare
 * `GET /:bucket` with no recognized subresource means "list objects",
 * which is object-listing logic that rightly lives in ObjectsService.
 */
@Controller()
@UseGuards(SignatureGuard)
export class BucketsController {
  constructor(
    private readonly bucketsService: BucketsService,
    private readonly policyService: PolicyService,
    @Inject(forwardRef(() => ObjectsService)) private readonly objectsService: ObjectsService,
  ) {}

  @Put(':bucket')
  async putBucket(
    @Param('bucket') bucket: string,
    @Query() query: Record<string, string>,
    @Body() body: any,
    @CurrentPrincipal() principal: Principal,
  ): Promise<any> {
    if ('policy' in query) {
      await this.assertOwner(bucket, principal);
      await this.policyService.attachBucketPolicy(bucket, body as BucketPolicyDto);
      return {};
    }
    if ('versioning' in query) {
      await this.assertOwner(bucket, principal);
      return this.bucketsService.setVersioning(bucket, (body as VersioningConfigDto).status);
    }
    if ('lifecycle' in query) {
      await this.assertOwner(bucket, principal);
      return this.bucketsService.setLifecycleRules(bucket, body as LifecycleRuleDto[]);
    }
    if ('encryption' in query) {
      await this.assertOwner(bucket, principal);
      return this.bucketsService.setEncryptionDefault(bucket, body as EncryptionConfigDto);
    }
    if ('cors' in query) {
      await this.assertOwner(bucket, principal);
      return this.bucketsService.setCors(bucket, body as CorsRuleDto[]);
    }

    return this.bucketsService.create(bucket, body as CreateBucketDto, principal.ownerId);
  }

  @Get()
  async listBuckets(@CurrentPrincipal() principal: Principal) {
    return this.bucketsService.list(principal.ownerId);
  }

  @Get(':bucket')
  async getBucketConfig(
    @Param('bucket') bucket: string,
    @Query() query: Record<string, string>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<any> {
    if ('policy' in query) {
      await this.assertOwner(bucket, principal);
      return this.policyService.getEffectivePolicy(bucket);
    }
    if ('versioning' in query) {
      const b = await this.bucketsService.findByName(bucket);
      return { status: b.versioningStatus };
    }
    if ('lifecycle' in query) {
      const b = await this.bucketsService.findByName(bucket);
      return { rules: b.lifecycleRules || [] };
    }
    if ('encryption' in query) {
      const b = await this.bucketsService.findByName(bucket);
      return b.defaultEncryption || {};
    }
    if ('cors' in query) {
      const b = await this.bucketsService.findByName(bucket);
      return { rules: b.corsConfig || [] };
    }
    if ('versions' in query) {
      return this.objectsService.listObjectVersions(bucket, query.prefix);
    }

    // No recognized subresource — this is a plain object listing.
    return this.objectsService.listObjects(bucket, query as any);
  }

  @Delete(':bucket')
  async deleteBucket(@Param('bucket') bucket: string, @CurrentPrincipal() principal: Principal): Promise<void> {
    await this.assertOwner(bucket, principal);
    return this.bucketsService.delete(bucket);
  }

  private async assertOwner(bucketName: string, principal: Principal): Promise<void> {
    const bucket = await this.bucketsService.findByName(bucketName);
    if (!principal.isRoot && bucket.ownerId !== principal.ownerId) {
      throw new ForbiddenException('Only the bucket owner can perform this action');
    }
  }
}

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  forwardRef,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ObjectsService } from './objects.service';
import { BucketsService } from '../buckets/buckets.service';
import { MultipartService } from '../multipart/multipart.service';
import { PolicyService } from '../access-control/policy.service';
import { PresignedUrlService } from '../access-control/presigned-url.service';
import { SignatureGuard } from '../auth/guards/signature.guard';
import { CurrentPrincipal } from '../common/decorators/current-principal.decorator';
import { Principal } from '../common/interfaces/principal.interface';
import { TagSetDto } from './dto/object.dto';
import { CompletePartsDto } from '../multipart/dto/multipart.dto';

/**
 * Owns every route rooted at `/:bucket/*key`. Multipart upload
 * (?uploads, ?uploadId, ?partNumber) turned out to share this exact route
 * space too — a separate MultipartController with its own @Put/@Post on the
 * same path would collide with these routes at the Express layer, since
 * routing only sees method + path, not query params. So multipart dispatch
 * lives here as well, delegating to MultipartService, alongside the
 * subresource dispatch already needed for tagging/copy/presign.
 */
@Controller(':bucket')
@UseGuards(SignatureGuard)
export class ObjectsController {
  constructor(
    private readonly objectsService: ObjectsService,
    @Inject(forwardRef(() => BucketsService)) private readonly bucketsService: BucketsService,
    @Inject(forwardRef(() => MultipartService)) private readonly multipartService: MultipartService,
    private readonly policyService: PolicyService,
    private readonly presignedUrlService: PresignedUrlService,
  ) {}

  @Put('*key')
  async putObject(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Req() req: Request,
    @Headers() headers: Record<string, string>,
    @Query() query: Record<string, string>,
    @CurrentPrincipal() principal: Principal,
  ) {
    await this.authorize(principal, 'PutObject', bucket, key);

    if ('uploadId' in query && 'partNumber' in query) {
      return this.multipartService.storePart(query.uploadId, Number(query.partNumber), req);
    }

    if (headers['x-amz-copy-source']) {
      const [sourceBucket, ...rest] = headers['x-amz-copy-source'].replace(/^\//, '').split('/');
      const sourceKey = rest.join('/');
      await this.authorize(principal, 'GetObject', sourceBucket, sourceKey);
      return this.objectsService.copyObject(sourceBucket, sourceKey, bucket, key);
    }

    const metaPrefix = 'x-amz-meta-';
    const collected = Object.keys(headers)
      .filter((h) => h.startsWith(metaPrefix))
      .reduce((acc, h) => ({ ...acc, [h.slice(metaPrefix.length)]: headers[h] }), {} as Record<string, string>);

    return this.objectsService.putObject(bucket, key, req, {
      contentType: headers['content-type'],
      userMetadata: Object.keys(collected).length ? collected : undefined,
    });
  }

  /**
   * Also serves HEAD requests. Express routes HEAD through whichever
   * handler is registered for GET on the same path — a separate @Head()
   * method on this same route never actually gets reached, since Express
   * resolves HEAD against the GET route first. So HEAD is handled here
   * explicitly (skip the body, keep the headers) rather than as a
   * dead second handler.
   */
  @Get('*key')
  async getObject(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Query() query: Record<string, string>,
    @Headers('range') range: string,
    @CurrentPrincipal() principal: Principal,
    @Res() res: Response,
  ) {
    const isHead = res.req.method === 'HEAD';

    if ('uploadId' in query) {
      await this.authorize(principal, 'PutObject', bucket, key);
      const parts = await this.multipartService.listParts(query.uploadId);
      res.json({ parts });
      return;
    }

    if ('presign' in query) {
      const method = (query.presign || 'GET') as 'GET' | 'PUT';
      await this.authorize(principal, method === 'PUT' ? 'PutObject' : 'GetObject', bucket, key);
      const url = this.presignedUrlService.generate(
        bucket,
        key,
        method,
        Number(query.expiresIn) || 3600,
        principal,
      );
      res.json({ url });
      return;
    }

    if ('tagging' in query) {
      await this.authorize(principal, 'GetObjectTagging', bucket, key);
      const tags = await this.objectsService.getTags(bucket, key);
      res.json({ tags });
      return;
    }

    await this.authorize(principal, 'GetObject', bucket, key);

    if (isHead) {
      const version = await this.objectsService.getObjectMetadata(bucket, key, query.versionId);
      res.setHeader('Content-Length', version.size);
      res.setHeader('Content-Type', version.contentType);
      res.setHeader('ETag', version.checksum);
      res.setHeader('x-amz-version-id', version.versionId);
      res.status(200).end();
      return;
    }

    const byteRange = this.parseRange(range);
    const { stream, version } = await this.objectsService.getObjectStream(bucket, key, query.versionId, byteRange);

    res.status(byteRange ? 206 : 200);
    res.setHeader('Content-Type', version.contentType);
    res.setHeader('ETag', version.checksum);
    res.setHeader('x-amz-version-id', version.versionId);
    stream.pipe(res);
  }

  @Delete('*key')
  async deleteObject(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Query() query: Record<string, string>,
    @CurrentPrincipal() principal: Principal,
  ) {
    if ('uploadId' in query) {
      await this.authorize(principal, 'PutObject', bucket, key);
      await this.multipartService.abort(query.uploadId);
      return {};
    }

    await this.authorize(principal, 'DeleteObject', bucket, key);
    return this.objectsService.deleteObject(bucket, key, query.versionId);
  }

  @Post('*key')
  async postObjectSubresource(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Query() query: Record<string, string>,
    @Headers('content-type') contentType: string,
    @Body() body: TagSetDto & CompletePartsDto,
    @CurrentPrincipal() principal: Principal,
  ) {
    if ('uploads' in query) {
      await this.authorize(principal, 'PutObject', bucket, key);
      return this.multipartService.initiate(bucket, key, contentType);
    }

    if ('uploadId' in query) {
      await this.authorize(principal, 'PutObject', bucket, key);
      return this.multipartService.complete(query.uploadId, body.parts);
    }

    if ('tagging' in query) {
      await this.authorize(principal, 'PutObjectTagging', bucket, key);
      await this.objectsService.setTags(bucket, key, body.tags);
      return {};
    }

    throw new ForbiddenException('Unsupported object subresource');
  }

  private async authorize(principal: Principal, action: string, bucket: string, key: string): Promise<void> {
    const bucketRecord = await this.bucketsService.findByName(bucket);
    const allowed = await this.policyService.evaluate(principal, action, `${bucket}/${key}`, bucketRecord.ownerId);
    if (!allowed) throw new ForbiddenException(`Not authorized to ${action} on ${bucket}/${key}`);
  }

  private parseRange(range?: string): { start: number; end: number } | undefined {
    if (!range) return undefined;
    const match = /bytes=(\d+)-(\d+)?/.exec(range);
    if (!match) return undefined;
    return { start: Number(match[1]), end: match[2] ? Number(match[2]) : Number.MAX_SAFE_INTEGER };
  }
}

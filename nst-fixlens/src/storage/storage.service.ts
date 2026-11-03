import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { isUUID } from 'class-validator';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
export interface DeletionIntent {
  version: 1;
  problem_id: string;
  user_id: string;
  requested_at: number;
  initial_cleanup_complete?: boolean;
}

const previewMaskPattern =
  /^previews\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[0-9a-f-]{36}\.png$/;

export function previewOutlineKey(maskKey: string) {
  if (!previewMaskPattern.test(maskKey))
    throw new Error('Invalid preview mask key');
  return maskKey.replace(/\.png$/, '.outline.png');
}

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('SPACES_BUCKET');
    const endpoint = config.getOrThrow<string>('SPACES_ENDPOINT');
    const region = new URL(endpoint).hostname.split('.')[0];
    this.client = new S3Client({
      requestChecksumCalculation: 'WHEN_REQUIRED',
      endpoint,
      region,
      credentials: {
        accessKeyId: config.getOrThrow<string>('SPACES_KEY'),
        secretAccessKey: config.getOrThrow<string>('SPACES_SECRET'),
      },
    });
  }
  async presign(photo_key: string) {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: photo_key,
        ContentType: 'image/jpeg',
      }),
      { expiresIn: 300 },
    );
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      expires_in: 300,
    };
  }
  async exists(photo_key: string): Promise<boolean> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: photo_key }),
      );
      return (
        result.ContentType === 'image/jpeg' && (result.ContentLength ?? 0) > 0
      );
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      )
        return false;
      throw error;
    }
  }
  presignRead(photo_key: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: photo_key }),
      { expiresIn: 300 },
    );
  }
  async putMask(key: string, png: Buffer, source = 'sam', outline?: Buffer) {
    const outlineKey = outline ? previewOutlineKey(key) : null;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: png,
        ContentType: 'image/png',
        Metadata: { 'outline-source': source },
      }),
    );
    if (outline && outlineKey)
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: outlineKey,
          Body: outline,
          ContentType: 'image/png',
        }),
      );
  }
  async readMask(key: string) {
    if (!previewMaskPattern.test(key))
      throw new Error('Invalid preview mask key');
    return this.readObject(key, 4 * 1024 * 1024);
  }
  async readPhoto(key: string): Promise<Buffer> {
    if (!/^captures\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/.test(key))
      throw new Error('Invalid capture photo key');
    return this.readObject(key, 25 * 1024 * 1024);
  }
  private async readObject(key: string, max: number): Promise<Buffer> {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
    const body = object.Body as Readable | undefined;
    if (!body) throw new Error('Photo body missing');
    if ((object.ContentLength ?? 0) > max) {
      body.destroy();
      throw new Error('Photo exceeds analysis size limit');
    }
    const parts: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of body) {
        const bytes = Buffer.from(chunk as Uint8Array);
        size += bytes.length;
        if (size > max) throw new Error('Photo exceeds analysis size limit');
        parts.push(bytes);
      }
      return Buffer.concat(parts);
    } finally {
      body.destroy();
    }
  }
  async putAnalysisPhoto(key: string, jpeg: Buffer) {
    if (
      !/^previews\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[0-9a-f-]{36}\.jpg$/.test(key)
    )
      throw new Error('Invalid analysis photo key');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: jpeg,
        ContentType: 'image/jpeg',
      }),
    );
  }
  async removeMask(key: string) {
    if (previewMaskPattern.test(key)) {
      const deleted = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: [key, previewOutlineKey(key)].map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      if (deleted.Errors?.length)
        throw new Error('Could not remove the preview mask and outline');
      return;
    }
    if (
      !/^masks\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[0-9a-f-]{36}\.png$/.test(key) &&
      !/^previews\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[0-9a-f-]{36}\.jpg$/.test(key)
    )
      throw new Error('Invalid generated mask key');
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
  async confirmMask(preview: string, key: string) {
    if (!previewMaskPattern.test(preview))
      throw new Error('Invalid preview mask key');
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: key,
        CopySource: `${this.bucket}/${preview}`,
        ContentType: 'image/png',
        MetadataDirective: 'COPY',
      }),
    );
  }
  private problemPrefixes(id: string, previewsOnly = false) {
    if (!isUUID(id)) throw new Error('Invalid problem storage scope');
    return (
      previewsOnly ? ['previews'] : ['captures', 'masks', 'previews']
    ).map((prefix) => `${prefix}/${id.toLowerCase()}/`);
  }
  async problemFiles(id: string) {
    const signal = AbortSignal.timeout(15_000);
    const result = { photos: 0, outlines: 0, previews: 0, bytes: 0 };
    for (const [index, prefix] of this.problemPrefixes(id).entries()) {
      let token: string | undefined;
      do {
        const page = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
          { abortSignal: signal },
        );
        for (const file of page.Contents ?? []) {
          if (!file.Key?.startsWith(prefix))
            throw new Error('Storage returned an out-of-scope key');
          const field = (['photos', 'outlines', 'previews'] as const)[index];
          result[field]++;
          result.bytes += file.Size ?? 0;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
        if (page.IsTruncated && !token)
          throw new Error('Incomplete storage listing');
      } while (token);
    }
    return result;
  }
  async clearProblemFiles(id: string, previewsOnly = false) {
    const signal = AbortSignal.timeout(15_000);
    let removed = 0;
    for (const prefix of this.problemPrefixes(id, previewsOnly)) {
      // Re-read the first page after deleting it: continuation tokens must not
      // skip objects when the listed set is being modified by this operation.
      for (let page = 0; ; page++) {
        if (page >= 100) throw new Error('Storage cleanup batch limit reached');
        const listed = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            MaxKeys: 1000,
          }),
          { abortSignal: signal },
        );
        const keys = (listed.Contents ?? []).map((file) => file.Key);
        if (!keys.length) break;
        if (keys.some((key) => !key?.startsWith(prefix)))
          throw new Error('Refusing out-of-scope storage deletion');
        const deleted = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
          { abortSignal: signal },
        );
        if (deleted.Errors?.length)
          throw new Error('Some job files could not be removed');
        removed += keys.length;
      }
    }
    return removed;
  }
  private deletionKey(id: string) {
    if (!isUUID(id)) throw new Error('Invalid deletion scope');
    return `deletions/${id.toLowerCase()}.json`;
  }
  async deletion(id: string): Promise<DeletionIntent | null> {
    let bytes: Buffer;
    try {
      bytes = await this.readObject(this.deletionKey(id), 4096);
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      )
        return null;
      throw error;
    }
    const value = JSON.parse(bytes.toString('utf8')) as DeletionIntent;
    if (
      value.version !== 1 ||
      value.problem_id !== id ||
      // PostgreSQL UUID identities include the fixed demo ID (version zero).
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value.user_id,
      ) ||
      !Number.isFinite(value.requested_at) ||
      value.requested_at > Date.now() + 60_000
    )
      throw new Error('Invalid deletion intent');
    return value;
  }
  async beginDeletion(intent: DeletionIntent) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.deletionKey(intent.problem_id),
        Body: JSON.stringify(intent),
        ContentType: 'application/json',
      }),
      { abortSignal: AbortSignal.timeout(15_000) },
    );
  }
  async pendingDeletions() {
    const page = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: 'deletions/',
        MaxKeys: 1000,
      }),
      { abortSignal: AbortSignal.timeout(15_000) },
    );
    const ids = (page.Contents ?? [])
      .map((file) => file.Key?.match(/^deletions\/([0-9a-f-]{36})\.json$/)?.[1])
      .filter((id): id is string => Boolean(id && isUUID(id)));
    const intents: DeletionIntent[] = [];
    for (const id of ids) {
      const intent = await this.deletion(id);
      if (intent) intents.push(intent);
    }
    return intents;
  }
  async finishDeletion(id: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.deletionKey(id),
      }),
      { abortSignal: AbortSignal.timeout(15_000) },
    );
  }
}

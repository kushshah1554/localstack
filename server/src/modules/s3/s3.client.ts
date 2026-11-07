import { S3Client } from '@aws-sdk/client-s3';
import { awsConfig } from '../../config/aws.ts';

export const bucket = process.env.S3_BUCKET ?? 'my-first-bucket';

// LocalStack needs path-style URLs (host/bucket/key).
export const s3 = new S3Client({ ...awsConfig, forcePathStyle: true });

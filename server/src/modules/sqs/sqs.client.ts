import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { setTimeout as sleep } from 'node:timers/promises';
import { awsConfig } from '../../config/aws.ts';

export const sqs = new SQSClient(awsConfig);

const queueUrls = new Map<string, string>();

// Queues are created by lambdas/compress-pdf/deploy.sh; code only knows their names.
async function getQueueUrl(name: string) {
  let url = queueUrls.get(name);
  if (!url) {
    url = (await sqs.send(new GetQueueUrlCommand({ QueueName: name }))).QueueUrl!;
    queueUrls.set(name, url);
  }
  return url;
}

export async function sendMessage(queueName: string, body: unknown) {
  await sqs.send(
    new SendMessageCommand({ QueueUrl: await getQueueUrl(queueName), MessageBody: JSON.stringify(body) })
  );
}

// Reads messages until `signal` is aborted. A message is deleted only after `handle` succeeds;
// if it throws, SQS shows the message again later, so handlers must be safe to run twice.
export async function pollQueue(
  queueName: string,
  handle: (body: unknown) => Promise<void>,
  signal: AbortSignal
) {
  while (!signal.aborted) {
    let queueUrl: string;
    let messages;
    try {
      queueUrl = await getQueueUrl(queueName);
      // Long polling: waits up to 20 s for a message instead of asking again and again.
      const res = await sqs.send(
        new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 }),
        { abortSignal: signal }
      );
      messages = res.Messages ?? [];
    } catch (err) {
      if (signal.aborted) return;
      console.error(`Could not read queue ${queueName}, trying again in 5 s`, err);
      await sleep(5000, undefined, { signal }).catch(() => {});
      continue;
    }

    for (const message of messages) {
      try {
        await handle(JSON.parse(message.Body!));
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
      } catch (err) {
        console.error(`Could not handle a message from ${queueName}, it will be retried`, err);
      }
    }
  }
}

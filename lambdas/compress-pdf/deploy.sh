#!/usr/bin/env bash
# Creates the S3 bucket and SQS queues and deploys the compress-pdf Lambda to LocalStack.
# Safe to run again: after changing index.mjs, and after every LocalStack restart.
#
#   Express ──> pdf-compress ──> Lambda ──> pdf-results ──> Express worker
#                   └─ fails 3 times ──> pdf-compress-dlq ──> Express worker (marks failed)
set -euo pipefail
cd "$(dirname "$0")"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="${AWS_REGION:-us-east-1}"
aws() { command aws --endpoint-url "${AWS_ENDPOINT_URL:-http://localhost:4566}" "$@"; }

name=compress-pdf

# --- Bucket (the free LocalStack plan has no persistence, so a restart wipes it) ---
bucket="${S3_BUCKET:-my-first-bucket}"
aws s3api head-bucket --bucket "$bucket" 2>/dev/null || aws s3api create-bucket --bucket "$bucket" >/dev/null

# --- Queues ---
make_queue() { aws sqs create-queue --queue-name "$1" --query QueueUrl --output text; }
queue_arn() { aws sqs get-queue-attributes --queue-url "$1" --attribute-names QueueArn --query Attributes.QueueArn --output text; }
# After 3 failed receives a message moves to the dead-letter queue. Visibility timeout is how long
# a message stays hidden while being worked on; for the Lambda queue it must exceed the Lambda timeout.
redrive() {
  python3 -c 'import json,sys; print(json.dumps({"VisibilityTimeout": sys.argv[2], "RedrivePolicy": json.dumps({"deadLetterTargetArn": sys.argv[1], "maxReceiveCount": "3"})}))' "$1" "$2"
}

jobs_dlq_url=$(make_queue pdf-compress-dlq)
jobs_url=$(make_queue pdf-compress)
aws sqs set-queue-attributes --queue-url "$jobs_url" --attributes "$(redrive "$(queue_arn "$jobs_dlq_url")" 360)"

# Results that the worker can never handle end up here instead of being retried forever.
results_dlq_url=$(make_queue pdf-results-dlq)
results_url=$(make_queue pdf-results)
aws sqs set-queue-attributes --queue-url "$results_url" --attributes "$(redrive "$(queue_arn "$results_dlq_url")" 30)"

# --- Lambda ---
npm install --omit=dev --silent
rm -f function.zip
python3 -m zipfile -c function.zip index.mjs package.json node_modules

env="Variables={RESULTS_QUEUE_URL=$results_url}"
if aws lambda get-function --function-name "$name" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$name" --zip-file fileb://function.zip >/dev/null
  aws lambda wait function-updated-v2 --function-name "$name"
  aws lambda update-function-configuration --function-name "$name" --environment "$env" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$name"
else
  # LocalStack accepts any role; on real AWS it needs S3 read/write, SQS send to pdf-results,
  # and SQS receive/delete on pdf-compress.
  aws lambda create-function --function-name "$name" \
    --runtime nodejs22.x --handler index.handler \
    --role arn:aws:iam::000000000000:role/lambda-role \
    --timeout 60 --memory-size 1024 \
    --environment "$env" \
    --zip-file fileb://function.zip >/dev/null
  aws lambda wait function-active-v2 --function-name "$name"
fi

# --- SQS starts the Lambda for each job ---
jobs_arn=$(queue_arn "$jobs_url")
mappings=$(aws lambda list-event-source-mappings --function-name "$name" --event-source-arn "$jobs_arn" \
  --query 'length(EventSourceMappings)' --output text)
if [ "$mappings" = "0" ]; then
  aws lambda create-event-source-mapping --function-name "$name" --event-source-arn "$jobs_arn" \
    --batch-size 1 >/dev/null
fi

echo "Deployed $name and queues"

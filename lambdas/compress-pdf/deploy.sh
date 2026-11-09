#!/usr/bin/env bash
# Builds the compress-pdf Lambda and deploys it to LocalStack. Run it again after changing index.mjs.
set -euo pipefail
cd "$(dirname "$0")"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="${AWS_REGION:-us-east-1}"
aws() { command aws --endpoint-url "${AWS_ENDPOINT_URL:-http://localhost:4566}" "$@"; }

name=compress-pdf

npm install --omit=dev --silent
rm -f function.zip
python3 -m zipfile -c function.zip index.mjs package.json node_modules

if aws lambda get-function --function-name "$name" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$name" --zip-file fileb://function.zip >/dev/null
  aws lambda wait function-updated-v2 --function-name "$name"
else
  # LocalStack accepts any role; on real AWS it needs read/write access to the bucket.
  aws lambda create-function --function-name "$name" \
    --runtime nodejs22.x --handler index.handler \
    --role arn:aws:iam::000000000000:role/lambda-role \
    --timeout 60 --memory-size 1024 \
    --zip-file fileb://function.zip >/dev/null
  aws lambda wait function-active-v2 --function-name "$name"
fi

echo "Deployed $name"

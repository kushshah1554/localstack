import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { awsConfig } from '../../config/aws.ts';

export const lambda = new LambdaClient(awsConfig);

// Runs a Lambda and waits for its result. A crash inside the function becomes a thrown error.
export async function invokeLambda<T>(functionName: string, payload: unknown): Promise<T> {
  const res = await lambda.send(
    new InvokeCommand({ FunctionName: functionName, Payload: JSON.stringify(payload) })
  );
  const result = JSON.parse(new TextDecoder().decode(res.Payload));
  if (res.FunctionError) {
    throw new Error(`Lambda ${functionName} failed: ${result?.errorType}: ${result?.errorMessage}`);
  }
  return result;
}

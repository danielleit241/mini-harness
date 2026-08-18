export interface ConfigValidation {
  warnings: string[];
}

const INFERENCE_PROFILE_PREFIX = /^(global|us|eu|apac)\./;
const AWS_REGION_PATTERN = /^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/;

export function validateConfig(env: NodeJS.ProcessEnv): ConfigValidation {
  const warnings: string[] = [];
  const modelId = env.BEDROCK_MODEL_ID;
  const region = env.AWS_REGION;

  if (modelId !== undefined && !INFERENCE_PROFILE_PREFIX.test(modelId)) {
    warnings.push(
      "BEDROCK_MODEL_ID should be an inference-profile id prefixed with global., us., eu., or apac."
    );
  }

  if (region !== undefined && !AWS_REGION_PATTERN.test(region)) {
    warnings.push(
      "AWS_REGION does not look like a valid AWS region (for example, us-east-1)."
    );
  }

  return { warnings };
}

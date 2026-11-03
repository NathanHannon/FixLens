export function validateEnv(env: Record<string, unknown>) {
  const required = [
    'SPACES_ENDPOINT',
    'SPACES_KEY',
    'SPACES_SECRET',
    'SPACES_BUCKET',
    'SEGMENTATION_SECRET',
  ];
  const missing = required.filter(
    (key) => typeof env[key] !== 'string' || !(env[key] as string).trim(),
  );
  // Database: either a single DATABASE_URL or the discrete managed-DB parts.
  const databaseUrl =
    typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
  if (!databaseUrl) {
    for (const key of [
      'DATABASE_HOST',
      'DATABASE_USERNAME',
      'DATABASE_PASSWORD',
      'DATABASE_NAME',
    ]) {
      if (typeof env[key] !== 'string' || !(env[key] as string).trim())
        missing.push(key);
    }
  }
  if (missing.length)
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')} ` +
        '(provide DATABASE_URL or all of DATABASE_HOST, DATABASE_USERNAME, DATABASE_PASSWORD, DATABASE_NAME)',
    );
  const port = Number(env.PORT ?? 3000);
  if (
    typeof env.SEGMENTATION_SECRET !== 'string' ||
    env.SEGMENTATION_SECRET.length < 32
  )
    throw new Error('SEGMENTATION_SECRET must contain at least 32 characters');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be an integer between 1 and 65535');
  if (env.DATABASE_PORT !== undefined && `${env.DATABASE_PORT}`.trim() !== '') {
    const dbPort = Number(env.DATABASE_PORT);
    if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535)
      throw new Error('DATABASE_PORT must be an integer between 1 and 65535');
  }
  const urlsToCheck = databaseUrl ? ['DATABASE_URL'] : [];
  urlsToCheck.push('SPACES_ENDPOINT');
  for (const key of urlsToCheck) {
    let url: URL;
    try {
      url = new URL(env[key] as string);
    } catch {
      throw new Error(`${key} must be a valid URL`);
    }
    if (
      key === 'DATABASE_URL' &&
      !['postgres:', 'postgresql:'].includes(url.protocol)
    )
      throw new Error('DATABASE_URL must use postgres:// or postgresql://');
    if (
      key === 'SPACES_ENDPOINT' &&
      !['https:', 'http:'].includes(url.protocol)
    )
      throw new Error('SPACES_ENDPOINT must use https:// or http://');
  }
  const provider = env.DIAGNOSIS_PROVIDER ?? 'mock';
  if (provider !== 'mock' && provider !== 'meta')
    throw new Error('DIAGNOSIS_PROVIDER must be mock or meta');
  const metaKey =
    typeof env.META_AI_API_KEY === 'string' ? env.META_AI_API_KEY.trim() : '';
  const fallbackKey =
    typeof env.MODEL_API_KEY === 'string' ? env.MODEL_API_KEY.trim() : '';
  if (provider === 'meta' && !metaKey && !fallbackKey)
    throw new Error(
      'DIAGNOSIS_PROVIDER=meta requires META_AI_API_KEY or MODEL_API_KEY',
    );
  const timeout = Number(env.META_TIMEOUT_MS ?? 90_000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 90_000)
    throw new Error(
      'META_TIMEOUT_MS must be an integer between 1000 and 90000',
    );
  const vision = env.META_VISION_MODEL ?? 'muse-spark-1.3';
  const sam = env.META_SAM_MODEL ?? 'sam-3.1';
  for (const [name, value] of [
    ['META_VISION_MODEL', vision],
    ['META_SAM_MODEL', sam],
  ]) {
    if (
      typeof value !== 'string' ||
      !/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(value)
    )
      throw new Error(`${name} must be a model identifier`);
  }
  return {
    ...env,
    PORT: port,
    DIAGNOSIS_PROVIDER: provider,
    META_TIMEOUT_MS: timeout,
    META_VISION_MODEL: vision,
    META_SAM_MODEL: sam,
  };
}

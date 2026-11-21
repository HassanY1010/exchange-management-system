import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'rediss://default:gQAAAAAAAW9lAAIgcDExMWRmZjY2YzBkMmE0MjI5YTdkZWNhYzVjZDBiYTI5NQ@exact-prawn-94053.upstash.io:6379';

let redisClient: Redis | null = null;

if (redisUrl && !redisUrl.includes('localhost:6379')) {
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 100, 1000)),
      lazyConnect: true,
    });

    redisClient.on('error', (err) => {
      console.warn('Redis client error (gracefully bypassing):', err.message);
    });
  } catch (err) {
    console.warn('Could not initialize Redis client, bypassing cache:', err);
  }
}

export const redis = redisClient;

/**
 * Safe Redis get with fallback
 */
export async function getCachedValue<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Safe Redis set with TTL in seconds
 */
export async function setCachedValue(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Ignore cache failure
  }
}

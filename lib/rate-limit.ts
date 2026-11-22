import { redis } from './redis';

interface AttemptRecord {
  count: number;
  firstAttemptAt: number;
  lastAttemptAt: number;
}

// In-memory fallback map
const memoryAttempts = new Map<string, AttemptRecord>();

// Clean up stale memory entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    memoryAttempts.forEach((record, key) => {
      if (now - record.lastAttemptAt > 30 * 60 * 1000) {
        memoryAttempts.delete(key);
      }
    });
  }, 5 * 60 * 1000);
}

export interface RateLimitResult {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
  totalAttempts: number;
}

/**
 * Check if an identifier (IP or email) is within rate limits for login
 * @param key identifier string (e.g., "ip:1.2.3.4" or "email:admin@exchange.com")
 * @param maxAttempts maximum allowed failed attempts (default 5)
 * @param windowSeconds time window in seconds (default 900 = 15 minutes)
 */
export async function checkRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowSeconds: number = 900
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  // 1. Check Redis if available
  if (redis) {
    try {
      const redisKey = `ratelimit:login:${key}`;
      const countStr = await redis.get(redisKey);
      const count = countStr ? parseInt(countStr, 10) : 0;
      if (count >= maxAttempts) {
        const ttl = await redis.ttl(redisKey);
        return {
          allowed: false,
          remainingAttempts: 0,
          retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
          totalAttempts: count,
        };
      }
      return {
        allowed: true,
        remainingAttempts: Math.max(0, maxAttempts - count),
        totalAttempts: count,
      };
    } catch {
      // Fallback to memory on Redis error
    }
  }

  // 2. In-memory check
  const record = memoryAttempts.get(key);
  if (!record) {
    return {
      allowed: true,
      remainingAttempts: maxAttempts,
      totalAttempts: 0,
    };
  }

  // Check if window expired
  if (now - record.firstAttemptAt > windowMs) {
    memoryAttempts.delete(key);
    return {
      allowed: true,
      remainingAttempts: maxAttempts,
      totalAttempts: 0,
    };
  }

  if (record.count >= maxAttempts) {
    const elapsedSeconds = Math.floor((now - record.firstAttemptAt) / 1000);
    const retryAfterSeconds = Math.max(1, windowSeconds - elapsedSeconds);
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds,
      totalAttempts: record.count,
    };
  }

  return {
    allowed: true,
    remainingAttempts: Math.max(0, maxAttempts - record.count),
    totalAttempts: record.count,
  };
}

/**
 * Record a failed login attempt
 */
export async function recordFailedAttempt(
  key: string,
  windowSeconds: number = 900
): Promise<number> {
  const now = Date.now();

  // 1. Record in Redis if available
  if (redis) {
    try {
      const redisKey = `ratelimit:login:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.expire(redisKey, windowSeconds);
      }
      // Also update in-memory
      updateMemoryAttempt(key, now, windowSeconds);
      return count;
    } catch {
      // Fallback to memory
    }
  }

  // 2. In-memory record
  return updateMemoryAttempt(key, now, windowSeconds);
}

function updateMemoryAttempt(key: string, now: number, windowSeconds: number): number {
  const windowMs = windowSeconds * 1000;
  const record = memoryAttempts.get(key);

  if (!record || now - record.firstAttemptAt > windowMs) {
    memoryAttempts.set(key, {
      count: 1,
      firstAttemptAt: now,
      lastAttemptAt: now,
    });
    return 1;
  }

  record.count += 1;
  record.lastAttemptAt = now;
  return record.count;
}

/**
 * Reset failed attempts upon successful login
 */
export async function resetRateLimit(key: string): Promise<void> {
  memoryAttempts.delete(key);
  if (redis) {
    try {
      await redis.del(`ratelimit:login:${key}`);
    } catch {}
  }
}

/**
 * Clears local process memory (used for restart simulation in tests)
 */
export function clearMemoryRateLimits(): void {
  memoryAttempts.clear();
}


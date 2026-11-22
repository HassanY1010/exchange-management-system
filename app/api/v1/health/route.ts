import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ensureDatabaseSchema } from '@/lib/db-init';

export async function GET() {
  const startTime = Date.now();
  let dbStatus = 'disconnected';

  try {
    await prisma.$queryRaw`SELECT 1`;
    await ensureDatabaseSchema();
    dbStatus = 'connected';
  } catch (error) {
    dbStatus = 'error';
  }

  const durationMs = Date.now() - startTime;
  const isHealthy = dbStatus === 'connected';

  return NextResponse.json(
    {
      status: isHealthy ? 'healthy' : 'unhealthy',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        latencyMs: durationMs,
      },
      environment: process.env.NODE_ENV || 'production',
      uptimeSeconds: process.uptime(),
    },
    { status: isHealthy ? 200 : 503 }
  );
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}

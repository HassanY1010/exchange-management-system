import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const prisma = new PrismaClient();
  try {
    // 1. Create _prisma_migrations table if not exists
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" VARCHAR(36) PRIMARY KEY NOT NULL,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      );
    `);

    // 2. Read migration file and calculate sha256 checksum
    const migrationSqlPath = path.join(process.cwd(), 'prisma', 'migrations', '20261121000000_init', 'migration.sql');
    const content = fs.readFileSync(migrationSqlPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(content).digest('hex');

    const migrationName = '20261121000000_init';
    const id = crypto.randomUUID();

    // 3. Update or Insert baseline record
    await prisma.$executeRawUnsafe(`
      DELETE FROM "_prisma_migrations" WHERE "migration_name" = $1;
    `, migrationName);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "applied_steps_count")
      VALUES ($1, $2, now(), $3, NULL, 1);
    `, id, checksum, migrationName);

    console.log(`Baseline migration ${migrationName} successfully recorded with checksum ${checksum}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);

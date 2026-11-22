import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest, authError } from '@/lib/auth';
import { getSystemStartOfDay, getSystemDayRange } from '@/lib/financial-core';
import { ensureDatabaseSchema, resetSchemaEnsuredFlag } from '@/lib/db-init';

/**
 * Helper to escape CSV fields according to RFC 4180
 */
function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(req: NextRequest) {
  // 1. Strict RBAC Enforcement
  const user = await getUserFromRequest(req);
  if (!user) return authError();

  const ALLOWED_ROLES = ['admin', 'auditor', 'general_manager'];
  if (!ALLOWED_ROLES.includes(user.role)) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح لك بالوصول أو الاطلاع على سجل التدقيق الرقابي' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action')?.trim();
  const entityType = searchParams.get('entityType')?.trim();
  const userId = searchParams.get('userId')?.trim();
  const status = searchParams.get('status')?.trim();
  const fromDate = searchParams.get('fromDate')?.trim();
  const toDate = searchParams.get('toDate')?.trim();
  const search = searchParams.get('search')?.trim();
  const exportFormat = searchParams.get('export')?.toLowerCase();

  // Pagination parameters
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
  const skip = (page - 1) * limit;

  // 2. Build Where Filter
  const whereClause: any = {};

  if (action && action !== 'all') {
    whereClause.action = action;
  }

  if (entityType && entityType !== 'all') {
    whereClause.entityType = entityType;
  }

  if (userId && userId !== 'all') {
    whereClause.userId = userId;
  }

  if (status && status !== 'all') {
    whereClause.status = status;
  }

  // Date Filtering in Africa/Cairo timezone
  if (fromDate || toDate) {
    whereClause.createdAt = {};
    if (fromDate) {
      whereClause.createdAt.gte = getSystemStartOfDay(fromDate, 'Africa/Cairo');
    }
    if (toDate) {
      whereClause.createdAt.lte = getSystemDayRange(toDate, 'Africa/Cairo').endOfDay;
    }
  }

  // Multi-field search
  if (search) {
    // Find any matching users by name or email to search by their ID
    const matchingUsers = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
      take: 20,
    });
    const matchedUserIds = matchingUsers.map((u) => u.id);

    whereClause.OR = [
      { reason: { contains: search, mode: 'insensitive' } },
      { entityId: { contains: search, mode: 'insensitive' } },
      { action: { contains: search, mode: 'insensitive' } },
      { entityType: { contains: search, mode: 'insensitive' } },
      { ipAddress: { contains: search, mode: 'insensitive' } },
      ...(matchedUserIds.length > 0 ? [{ userId: { in: matchedUserIds } }] : []),
    ];
  }

  // Ensure database schema additions exist (self-healing for remote environments)
  await ensureDatabaseSchema();

  // 3. Handle Export Requests (CSV or JSON)
  if (exportFormat === 'csv' || exportFormat === 'json') {
    const exportTake = 2000;
    let exportLogs;
    try {
      exportLogs = await prisma.auditLog.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: exportTake,
      });
    } catch (dbErr: any) {
      if (dbErr?.code === 'P2022') {
        resetSchemaEnsuredFlag();
        await ensureDatabaseSchema();
        exportLogs = await prisma.auditLog.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          take: exportTake,
        });
      } else {
        throw dbErr;
      }
    }

    // Helper to safely extract role name as string
    const getRoleName = (role: any): string => {
      if (!role) return 'unknown';
      if (typeof role === 'string') return role;
      if (typeof role === 'object' && role !== null) return role.name || role.id || 'unknown';
      return String(role);
    };

    // Resolve user names
    const uniqueUserIds = Array.from(new Set(exportLogs.map((l) => l.userId).filter(Boolean))) as string[];
    const users = await prisma.user.findMany({
      where: { id: { in: uniqueUserIds } },
      select: { id: true, name: true, email: true, role: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const enrichedExport = exportLogs.map((log) => {
      const u = log.userId ? userMap.get(log.userId) : null;
      return {
        ...log,
        userName: u?.name || log.userId || 'النظام / غير محدد',
        userRole: u ? getRoleName(u.role) : '—',
        cairoTime: new Intl.DateTimeFormat('ar-EG', {
          timeZone: 'Africa/Cairo',
          dateStyle: 'medium',
          timeStyle: 'medium',
        }).format(new Date(log.createdAt)),
      };
    });

    if (exportFormat === 'csv') {
      const header = ['معرف السجل', 'التاريخ والوقت (توقيت القاهرة)', 'المستخدم', 'الدور', 'نوع العملية', 'الكيان', 'معرف الكيان', 'النتيجة', 'السبب / البيان', 'عنوان IP'].map(escapeCsv).join(',');
      const rows = enrichedExport.map((l) =>
        [
          escapeCsv(l.id),
          escapeCsv(l.cairoTime),
          escapeCsv(l.userName),
          escapeCsv(l.userRole),
          escapeCsv(l.action),
          escapeCsv(l.entityType),
          escapeCsv(l.entityId || '—'),
          escapeCsv(l.status === 'SUCCESS' ? 'ناجحة' : 'فاشلة'),
          escapeCsv(l.reason || '—'),
          escapeCsv(l.ipAddress || '—'),
        ].join(',')
      );

      // Prepend UTF-8 BOM so Excel opens Arabic correctly
      const csvContent = '\uFEFF' + [header, ...rows].join('\r\n');
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit_logs_${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: enrichedExport,
      count: enrichedExport.length,
    });
  }

  // 4. Paginated Database Query
  let totalCount: number;
  let logs: any[];
  try {
    [totalCount, logs] = await Promise.all([
      prisma.auditLog.count({ where: whereClause }),
      prisma.auditLog.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
  } catch (dbErr: any) {
    if (dbErr?.code === 'P2022') {
      resetSchemaEnsuredFlag();
      await ensureDatabaseSchema();
      [totalCount, logs] = await Promise.all([
        prisma.auditLog.count({ where: whereClause }),
        prisma.auditLog.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);
    } else {
      throw dbErr;
    }
  }

  // Enrich logs with User information
  const getRoleName = (role: any): string => {
    if (!role) return 'unknown';
    if (typeof role === 'string') return role;
    if (typeof role === 'object' && role !== null) return role.name || role.id || 'unknown';
    return String(role);
  };

  const uniqueUserIds = Array.from(new Set(logs.map((l) => l.userId).filter(Boolean))) as string[];
  const users = await prisma.user.findMany({
    where: { id: { in: uniqueUserIds } },
    select: { id: true, name: true, email: true, role: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const enrichedLogs = logs.map((log) => {
    const u = log.userId ? userMap.get(log.userId) : null;
    return {
      ...log,
      user: u
        ? { id: u.id, name: u.name, email: u.email, role: getRoleName(u.role) }
        : log.userId
        ? { id: log.userId, name: log.userId, role: 'unknown' }
        : { id: 'system', name: 'النظام الآلي', role: 'system' },
      cairoCreatedAt: new Intl.DateTimeFormat('ar-EG', {
        timeZone: 'Africa/Cairo',
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(new Date(log.createdAt)),
    };
  });

  const totalPages = Math.ceil(totalCount / limit);

  return NextResponse.json({
    success: true,
    data: enrichedLogs,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  });
}

// 5. Immutability Protection: Rejection of any write, update, or delete operations
export async function POST(req: NextRequest) {
  return NextResponse.json(
    { success: false, error: 'سجل التدقيق الرقابي محمي وثابت برمجياً ولا يقبل الإنشاء اليدوي المباشر عبر API' },
    { status: 405 }
  );
}

export async function PUT(req: NextRequest) {
  return NextResponse.json(
    { success: false, error: 'سجل التدقيق الرقابي محمي وثابت برمجياً ولا يمكن تعديل أي سجل منه نهائياً' },
    { status: 405 }
  );
}

export async function PATCH(req: NextRequest) {
  return NextResponse.json(
    { success: false, error: 'سجل التدقيق الرقابي محمي وثابت برمجياً ولا يمكن تعديل أي سجل منه نهائياً' },
    { status: 405 }
  );
}

export async function DELETE(req: NextRequest) {
  return NextResponse.json(
    { success: false, error: 'سجل التدقيق الرقابي محمي وثابت برمجياً ولا يمكن حذف أي سجل منه نهائياً' },
    { status: 405 }
  );
}

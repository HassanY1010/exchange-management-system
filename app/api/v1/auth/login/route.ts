import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { generateToken } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import { checkRateLimit, recordFailedAttempt, resetRateLimit } from '@/lib/rate-limit';

// Dummy bcrypt hash to defend against timing attacks for non-existent users
const DUMMY_HASH = '$2a$10$DZj82yV3c7E4d9Yd4fJ5c.ZtV5vQ6N2F9vW6C0r7nJ3uL1oP4q';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email, password } = body;

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Rate Limiting check (by IP and by Email)
    const ipLimit = await checkRateLimit(`ip:${ip}`, 5, 900);
    const emailLimit = await checkRateLimit(`email:${normalizedEmail}`, 5, 900);

    if (!ipLimit.allowed || !emailLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds || 0, emailLimit.retryAfterSeconds || 0, 60);
      await logAuditEvent({
        action: 'LOGIN_FAILED',
        entityType: 'User',
        reason: `تم حظر محاولة الدخول لتجاوز الحد الأقصى للمحاولات (Rate limit exceeded) لـ ${normalizedEmail}`,
        ipAddress: ip,
      });

      return NextResponse.json(
        {
          error: `تم تجاوز الحد المسموح من محاولات الدخول الخاطئة. يرجى الانتظار ${Math.ceil(retryAfter / 60)} دقيقة قبل المحاولة مرة أخرى.`,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
          },
        }
      );
    }

    // 2. Query user from DB
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { role: true },
    });

    if (!user) {
      // Execute dummy bcrypt to equalize timing
      await bcrypt.compare(password, DUMMY_HASH);
      await recordFailedAttempt(`ip:${ip}`, 900);
      await recordFailedAttempt(`email:${normalizedEmail}`, 900);

      await logAuditEvent({
        action: 'LOGIN_FAILED',
        entityType: 'User',
        reason: `محاولة دخول فاشلة لبريد غير موجود: ${normalizedEmail}`,
        ipAddress: ip,
      });

      return NextResponse.json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' }, { status: 401 });
    }

    // 3. Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      await recordFailedAttempt(`ip:${ip}`, 900);
      await recordFailedAttempt(`email:${normalizedEmail}`, 900);

      await logAuditEvent({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        reason: 'كلمة المرور غير صحيحة',
        ipAddress: ip,
      });

      return NextResponse.json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' }, { status: 401 });
    }

    // 4. Verify account status (prevent inactive or suspended accounts from logging in)
    if (user.status !== 'active') {
      await logAuditEvent({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        reason: `محاولة دخول لحساب غير نشط أو موقوف (الحالة: ${user.status})`,
        ipAddress: ip,
      });

      return NextResponse.json(
        { error: 'هذا الحساب معطل أو موقوف. يرجى مراجعة إدارة النظام' },
        { status: 403 }
      );
    }

    // 5. Successful login: reset rate limits
    await resetRateLimit(`ip:${ip}`);
    await resetRateLimit(`email:${normalizedEmail}`);

    const token = generateToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role.name,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await logAuditEvent({
      userId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      reason: 'تسجيل دخول ناجح إلى النظام',
      ipAddress: ip,
    });

    const res = NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role.name,
      },
    });

    res.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 7 * 24 * 3600,
      sameSite: 'lax',
    });

    return res;
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع في الخادم' }, { status: 500 });
  }
}

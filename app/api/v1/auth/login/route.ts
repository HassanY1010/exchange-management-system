import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { generateToken } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    if (!user) {
      await logAuditEvent({
        action: 'LOGIN_FAILED',
        entityType: 'User',
        reason: `محاولة دخول فاشلة لبريد غير موجود: ${email}`,
        ipAddress: req.headers.get('x-forwarded-for') || '127.0.0.1',
      });
      return NextResponse.json({ error: 'بيانات تسجيل الدخول غير صحيحة' }, { status: 401 });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      await logAuditEvent({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        reason: 'كلمة المرور غير صحيحة',
        ipAddress: req.headers.get('x-forwarded-for') || '127.0.0.1',
      });
      return NextResponse.json({ error: 'بيانات تسجيل الدخول غير صحيحة' }, { status: 401 });
    }

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
      action: 'LOGIN_SUCCESS',
      entityType: 'User',
      entityId: user.id,
      reason: 'تسجيل دخول ناجح',
      ipAddress: req.headers.get('x-forwarded-for') || '127.0.0.1',
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
      path: '/',
      maxAge: 7 * 24 * 3600,
      sameSite: 'lax',
    });

    return res;
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'حدث خطأ في الخادم' }, { status: 500 });
  }
}

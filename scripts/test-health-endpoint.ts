import assert from 'assert';
import { prisma } from '../lib/db';
import { GET, HEAD } from '../app/api/health/route';

async function runHealthEndpointTests() {
  console.log('========================================================================');
  console.log('  فحص واختبار Endpoint صحة النظام: /api/health                          ');
  console.log('  التحقق من: خفة الحجم، صحة JSON، أكواد الحالة، ومنع تسريب المعلومات      ');
  console.log('========================================================================\n');

  let passedTests = 0;
  const originalQueryRaw = prisma.$queryRaw;

  try {
    // -------------------------------------------------------------------------
    // اختبار 1: الحالة السليمة (Healthy State - 200 OK)
    // -------------------------------------------------------------------------
    console.log('[اختبار 1] فحص الاستجابة عند سلامة الخدمة وقاعدة البيانات:');
    (prisma as any).$queryRaw = async () => [{ 1: 1 }];

    const healthyRes = await GET();
    const healthyText = await healthyRes.text();
    const healthySize = Buffer.byteLength(healthyText, 'utf8');

    assert.strictEqual(healthyRes.status, 200, 'يجب أن يكون كود الحالة 200');
    assert.strictEqual(
      healthyRes.headers.get('content-type'),
      'application/json',
      'يجب أن يكون Content-Type هو application/json'
    );
    assert.strictEqual(
      healthyRes.headers.get('cache-control'),
      'no-store, no-cache, must-revalidate',
      'يجب منع التخزين المؤقت عبر Cache-Control'
    );

    const healthyJson = JSON.parse(healthyText);
    assert.deepStrictEqual(healthyJson, { status: 'ok' }, 'يجب أن تكون الاستجابة {"status":"ok"}');
    assert.ok(healthySize <= 30, `حجم الاستجابة (${healthySize} بايت) يجب ألا يتجاوز 30 بايت`);

    console.log(`  ✓ كود الحالة: ${healthyRes.status} OK`);
    console.log(`  ✓ نص الاستجابة: ${healthyText}`);
    console.log(`  ✓ حجم الاستجابة الفعلي: ${healthySize} بايت (صغير جدًا ومناسب للمراقبة)`);
    passedTests++;

    // -------------------------------------------------------------------------
    // اختبار 2: الحالة غير السليمة - فشل اتصال قاعدة البيانات (Unhealthy - 503)
    // -------------------------------------------------------------------------
    console.log('\n[اختبار 2] فحص الاستجابة عند فشل اتصال قاعدة البيانات (503 Service Unavailable):');
    (prisma as any).$queryRaw = async () => {
      throw new Error("Can't reach database server at aws-1-ap-northeast-1.pooler.supabase.com:5432");
    };

    const errorRes = await GET();
    const errorText = await errorRes.text();
    const errorSize = Buffer.byteLength(errorText, 'utf8');

    assert.strictEqual(errorRes.status, 503, 'يجب أن يكون كود الحالة 503 عند تعطل قاعدة البيانات');
    assert.strictEqual(
      errorRes.headers.get('content-type'),
      'application/json',
      'يجب أن يكون Content-Type هو application/json'
    );

    const errorJson = JSON.parse(errorText);
    assert.deepStrictEqual(errorJson, { status: 'error' }, 'يجب أن تكون الاستجابة {"status":"error"}');
    assert.ok(errorSize <= 30, `حجم الاستجابة عند الخطأ (${errorSize} بايت) يجب ألا يتجاوز 30 بايت`);

    console.log(`  ✓ كود الحالة: ${errorRes.status} Service Unavailable`);
    console.log(`  ✓ نص الاستجابة: ${errorText}`);
    console.log(`  ✓ حجم استجابة الخطأ: ${errorSize} بايت (خفيف ومضغوط)`);
    passedTests++;

    // -------------------------------------------------------------------------
    // اختبار 3: فحص مهلة الاتصال عند تجمد قاعدة البيانات (Timeout Handling)
    // -------------------------------------------------------------------------
    console.log('\n[اختبار 3] فحص معالجة المهلة الزمنية عند بطء أو تجمد قاعدة البيانات:');
    (prisma as any).$queryRaw = () => new Promise((resolve) => setTimeout(resolve, 10000));

    const timeoutStartTime = Date.now();
    const timeoutRes = await GET();
    const elapsedMs = Date.now() - timeoutStartTime;
    const timeoutText = await timeoutRes.text();

    assert.strictEqual(timeoutRes.status, 503, 'يجب أن تفشل الاستجابة بـ 503 عند تجاوز المهلة');
    assert.deepStrictEqual(JSON.parse(timeoutText), { status: 'error' });
    assert.ok(elapsedMs < 4500, `يجب قطع الاتصال خلال المهلة المحددة (~3000ms)، استغرق: ${elapsedMs}ms`);

    console.log(`  ✓ تم قطع الاتصال المتجمد خلال: ${elapsedMs}ms`);
    console.log(`  ✓ كود الحالة: ${timeoutRes.status} مع استجابة آمنة: ${timeoutText}`);
    passedTests++;

    // -------------------------------------------------------------------------
    // اختبار 4: التدقيق الأمني وعدم تسريب أي بيانات حساسة (Security & Data Leak Audit)
    // -------------------------------------------------------------------------
    console.log('\n[اختبار 4] فحص الأمان وعدم تسريب أي معلومات حساسة أو تفاصيل بيئة:');
    const sensitiveTokens = [
      'password',
      'secret',
      'token',
      'database',
      'postgres',
      'supabase',
      '5432',
      'pooler',
      'user',
      'account',
      'balance',
      'ledger',
      'voucher',
      'transaction',
      'stack',
      'node_modules',
      'error_code',
      'timestamp',
      'latency',
      'uptime',
      'production',
      'development',
    ];

    for (const [scenario, text] of [
      ['الحالة السليمة (200)', healthyText],
      ['حالة الخطأ (503)', errorText],
      ['حالة المهلة (503)', timeoutText],
    ]) {
      const lower = text.toLowerCase();
      for (const token of sensitiveTokens) {
        assert.ok(
          !lower.includes(token),
          `تم اكتشاف تسريب محتمل للمصطلح الحساس "${token}" في سيناريو ${scenario}!`
        );
      }
      const parsed = JSON.parse(text);
      const keys = Object.keys(parsed);
      assert.deepStrictEqual(
        keys,
        ['status'],
        `يجب ألا يحتوي كائن JSON إلا على الحقل "status" فقط في ${scenario}. الموجود: ${JSON.stringify(keys)}`
      );
    }
    console.log('  ✓ تم التحقق بنجاح: لا يوجد أي تسريب لكلمات المرور، السجلات، عناوين DB، أو تفاصيل الأخطاء');
    console.log('  ✓ تم التحقق: الحقل الوحيد المعاد هو "status" دائمًا وبحجم ضئيل جدًا');
    passedTests++;

    // -------------------------------------------------------------------------
    // اختبار 5: فحص دعم طلبات HEAD (Monitoring HEAD pings)
    // -------------------------------------------------------------------------
    console.log('\n[اختبار 5] فحص طلبات HEAD المخصصة للمراقبة السريعة:');
    (prisma as any).$queryRaw = async () => [{ 1: 1 }];
    const headHealthy = await HEAD();
    assert.strictEqual(headHealthy.status, 200, 'يجب أن يعيد HEAD كود 200 عند السلامة');
    const headHealthyBody = await headHealthy.text();
    assert.strictEqual(headHealthyBody, '', 'يجب أن يكون جسم استجابة HEAD فارغًا تمامًا');

    (prisma as any).$queryRaw = async () => {
      throw new Error('Connection refused');
    };
    const headUnhealthy = await HEAD();
    assert.strictEqual(headUnhealthy.status, 503, 'يجب أن يعيد HEAD كود 503 عند التعطل');
    const headUnhealthyBody = await headUnhealthy.text();
    assert.strictEqual(headUnhealthyBody, '', 'يجب أن يكون جسم استجابة HEAD فارغًا تمامًا عند الخطأ');

    console.log('  ✓ استجابة HEAD السليمة: 200 OK مع حجم 0 بايت');
    console.log('  ✓ استجابة HEAD المعطلة: 503 Service Unavailable مع حجم 0 بايت');
    passedTests++;

    // -------------------------------------------------------------------------
    // اختبار 6: فحص المسار الفعلي المباشر بدون Mock
    // -------------------------------------------------------------------------
    console.log('\n[اختبار 6] الفحص الحي المباشر لـ Endpoint مع بيئة التشغيل الحالية:');
    (prisma as any).$queryRaw = originalQueryRaw;

    const liveRes = await GET();
    const liveText = await liveRes.text();
    const liveSize = Buffer.byteLength(liveText, 'utf8');
    const liveJson = JSON.parse(liveText);

    assert.ok(
      [200, 503].includes(liveRes.status),
      `كود الحالة يجب أن يكون إما 200 أو 503، وجد: ${liveRes.status}`
    );
    assert.ok(
      liveJson.status === 'ok' || liveJson.status === 'error',
      `قيمة status يجب أن تكون ok أو error، وجد: ${liveJson.status}`
    );
    assert.ok(
      liveSize <= 30,
      `حجم الاستجابة الحية (${liveSize} بايت) يجب ألا يتجاوز 30 بايت`
    );

    console.log(`  ✓ كود الحالة المباشر: ${liveRes.status}`);
    console.log(`  ✓ محتوى الاستجابة: ${liveText}`);
    console.log(`  ✓ الحجم الفعلي: ${liveSize} بايت`);
    passedTests++;

    console.log('\n========================================================================');
    console.log(`  🎉 نجحت جميع الاختبارات بنسبة 100% (${passedTests}/${passedTests})!`);
    console.log('  تم التحقق الكامل من معالجة سبب Failed (output too large)');
    console.log('========================================================================\n');
  } finally {
    (prisma as any).$queryRaw = originalQueryRaw;
    await prisma.$disconnect().catch(() => {});
  }
}

runHealthEndpointTests().catch((err) => {
  console.error('❌ فشل في اختبارات Endpoint صحة النظام:', err);
  process.exit(1);
});

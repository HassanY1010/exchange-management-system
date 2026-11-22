import { GET as getSuppliers, POST as createSupplier } from '../app/api/v1/suppliers/route';
import { GET as getSupplierById, PATCH as updateSupplier, DELETE as deleteSupplier } from '../app/api/v1/suppliers/[id]/route';
import { GET as getTransactions, POST as createTransaction } from '../app/api/v1/supplier-transactions/route';
import { NextRequest } from 'next/server';
import { prisma } from '../lib/db';
import { generateToken } from '../lib/auth';

let apiPass = 0;
let apiTotal = 0;

function assert(cond: boolean, name: string, detail?: any) {
  apiTotal++;
  if (cond) {
    apiPass++;
    console.log(`  [PASS] API Test ${apiTotal}: ${name}`);
  } else {
    console.error(`  [FAIL] API Test ${apiTotal}: ${name}`, detail || '');
    throw new Error(`Failed: ${name}`);
  }
}

function createMockRequest(url: string, method: string = 'GET', body?: any, token?: string) {
  const headers: any = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const reqInit: any = {
    method,
    headers,
  };
  if (body) {
    reqInit.body = JSON.stringify(body);
  }
  return new NextRequest(url, reqInit);
}

async function runApiTests() {
  console.log('================================================================');
  console.log('   API ENDPOINTS & RBAC AUDIT: /api/v1/suppliers & transactions');
  console.log('================================================================\n');

  const adminToken = generateToken({
    userId: 'admin-test-id',
    email: 'admin@system.com',
    name: 'Admin Tester',
    role: 'admin',
  });

  const cashierToken = generateToken({
    userId: 'cashier-test-id',
    email: 'cashier@system.com',
    name: 'Cashier Tester',
    role: 'cashier',
  });

  // Test 1: GET /api/v1/suppliers unauthenticated -> 401
  const reqUnauth = createMockRequest('http://localhost:3000/api/v1/suppliers');
  const resUnauth = await getSuppliers(reqUnauth);
  assert(resUnauth.status === 401, 'Unauthenticated request to GET /api/v1/suppliers returns 401');

  // Test 2: GET /api/v1/supplier-transactions unauthenticated -> 401
  const reqTxUnauth = createMockRequest('http://localhost:3000/api/v1/supplier-transactions');
  const resTxUnauth = await getTransactions(reqTxUnauth);
  assert(resTxUnauth.status === 401, 'Unauthenticated request to GET /api/v1/supplier-transactions returns 401');

  // Test 3: Authenticated GET /api/v1/suppliers -> 200 with data array
  const reqAuthSup = createMockRequest('http://localhost:3000/api/v1/suppliers', 'GET', undefined, adminToken);
  const resAuthSup = await getSuppliers(reqAuthSup);
  const dataAuthSup = await resAuthSup.json();
  assert(resAuthSup.status === 200 && dataAuthSup.success === true, 'Authenticated GET /api/v1/suppliers returns 200 with data');
  assert(Array.isArray(dataAuthSup.data), 'GET /api/v1/suppliers data is an array of suppliers');

  // Test 4: Authenticated GET /api/v1/supplier-transactions -> 200 with inventories and kpis
  const reqAuthTx = createMockRequest('http://localhost:3000/api/v1/supplier-transactions', 'GET', undefined, adminToken);
  const resAuthTx = await getTransactions(reqAuthTx);
  const dataAuthTx = await resAuthTx.json();
  assert(resAuthTx.status === 200 && dataAuthTx.success === true, 'Authenticated GET /api/v1/supplier-transactions returns 200');
  assert(Array.isArray(dataAuthTx.inventories), 'Response contains inventories array');
  assert(typeof dataAuthTx.kpis === 'object', 'Response contains calculated trading KPIs');

  // Test 5: RBAC restriction on POST /api/v1/supplier-transactions -> Cashier role returns 403
  const reqCashierTrade = createMockRequest(
    'http://localhost:3000/api/v1/supplier-transactions',
    'POST',
    {
      supplierId: 'dummy-supplier-id',
      transactionType: 'BUY_SDG_PAY_EGP',
      fromAmount: 1000000,
      toAmount: 5000,
      exchangeRate: 200,
    },
    cashierToken
  );
  const resCashierTrade = await createTransaction(reqCashierTrade);
  assert(resCashierTrade.status === 403, 'Cashier role attempting to execute supplier currency trade receives 403 Forbidden');

  // Test 6: Input validation on POST /api/v1/supplier-transactions -> Missing fields returns 400
  const reqInvalidTrade = createMockRequest(
    'http://localhost:3000/api/v1/supplier-transactions',
    'POST',
    {
      fromAmount: 1000000,
    },
    adminToken
  );
  const resInvalidTrade = await createTransaction(reqInvalidTrade);
  assert(resInvalidTrade.status === 400, 'POST /api/v1/supplier-transactions with missing fields returns 400');

  // Test 7: Non-existent supplier returns 404
  const reqNonExistent = createMockRequest(
    'http://localhost:3000/api/v1/supplier-transactions',
    'POST',
    {
      supplierId: '00000000-0000-0000-0000-000000000000',
      transactionType: 'BUY_SDG_PAY_EGP',
      fromAmount: 1000000,
      toAmount: 5000,
      exchangeRate: 200,
    },
    adminToken
  );
  const resNonExistent = await createTransaction(reqNonExistent);
  assert(resNonExistent.status === 404, 'Trading with non-existent supplier returns 404 Not Found');

  console.log('\n================================================================');
  console.log(`   ALL API TESTS PASSED: ${apiPass} / ${apiTotal} (100%)`);
  console.log('================================================================\n');
}

runApiTests()
  .catch((e) => {
    console.error('API test suite failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

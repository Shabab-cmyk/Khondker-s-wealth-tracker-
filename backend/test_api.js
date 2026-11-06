/**
 * Automated Verification Script for Personal Finance API
 */

const http = require('http');

const API_BASE = 'http://localhost:5000/api/v1';

function request(path, method = 'GET', data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, body: parsed, raw: body });
        } catch (e) {
          resolve({ status: res.statusCode, body: null, raw: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING PERSONAL FINANCE API TESTS ---');
  let testCount = 0;
  let passCount = 0;

  function assert(condition, message) {
    testCount++;
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passCount++;
    } else {
      console.error(`❌ FAIL: ${message}`);
    }
  }

  try {
    // 1. Health Check
    const health = await request('/health');
    assert(health.status === 200 && health.body.status === 'ok', 'Health Check endpoint /health');

    // 2. User Login
    const login = await request('/auth/login', 'POST', { email: 'demo@wealth.io', password: 'demo1234' });
    assert(login.status === 200 && login.body.token, 'Login with demo user (JWT token returned)');
    const token = login.body ? login.body.token : null;

    // 3. Register New User
    const testEmail = `test_${Date.now()}@wealth.io`;
    const reg = await request('/auth/register', 'POST', { email: testEmail, password: 'password123', preferred_currency: 'BDT', baseline_budget: 45000 });
    assert(reg.status === 201 && reg.body.token, 'Register new user with BDT currency');
    const newToken = reg.body ? reg.body.token : token;

    // 4. Fetch User Profile
    const me = await request('/auth/me', 'GET', null, newToken);
    assert(me.status === 200 && me.body.email === testEmail, 'Fetch authenticated user profile /me');

    // 5. Create Custom Categories (Income & Expense)
    const incCatRes = await request('/categories', 'POST', { name: 'Salary Income', type: 'INCOME', budget_limit: 0 }, newToken);
    assert(incCatRes.status === 201 && incCatRes.body.name === 'Salary Income', 'Create custom income category');
    const incomeCatId = incCatRes.body.id;

    const expCatRes = await request('/categories', 'POST', { name: 'House Rent', type: 'EXPENSE', budget_limit: 15000 }, newToken);
    assert(expCatRes.status === 201 && expCatRes.body.name === 'House Rent', 'Create custom expense category');
    const expenseCatId = expCatRes.body.id;

    // 6. Delete Category Endpoint Test
    const delCatRes = await request(`/categories/${expCatRes.body.id}`, 'DELETE', null, newToken);
    assert(delCatRes.status === 200, 'Delete custom category');

    // Re-create expense category for transactions test
    const expCat2 = await request('/categories', 'POST', { name: 'Groceries', type: 'EXPENSE', budget_limit: 8000 }, newToken);

    // 7. Create Income Transaction
    const incTx = await request('/transactions', 'POST', {
      category_id: incomeCatId,
      amount: 50000,
      type: 'INCOME',
      transaction_date: '2026-08-01',
      description: 'Monthly Salary Credit BDT',
      payment_method: 'Bank Transfer'
    }, newToken);
    assert(incTx.status === 201 && incTx.body && incTx.body.amount === 50000, 'Create positive income transaction');

    // 8. Create Expense Transaction
    const expTx = await request('/transactions', 'POST', {
      category_id: expCat2.body.id,
      amount: 4500,
      type: 'EXPENSE',
      transaction_date: '2026-08-05',
      description: 'Weekly Groceries BDT',
      payment_method: 'Cash'
    }, newToken);
    assert(expTx.status === 201 && expTx.body && expTx.body.amount === 4500, 'Create valid expense transaction');

    // 9. Create and Delete Savings Goal Test
    const goalRes = await request('/goals', 'POST', {
      goal_name: 'Laptop Fund',
      target_amount: 60000,
      current_amount: 5000
    }, newToken);
    assert(goalRes.status === 201 && goalRes.body.goal_name === 'Laptop Fund', 'Create custom savings goal');

    const delGoalRes = await request(`/goals/${goalRes.body.id}`, 'DELETE', null, newToken);
    assert(delGoalRes.status === 200, 'Delete savings goal');

    // 10. Reset All Transactions Test
    const resetRes = await request('/transactions/reset', 'POST', null, newToken);
    assert(resetRes.status === 200 && resetRes.body && resetRes.body.message.includes('reset'), 'Reset all transactions to zero (0 ৳)');

    console.log(`\n--- TEST SUMMARY: ${passCount}/${testCount} TESTS PASSED ---`);
    if (passCount === testCount) {
      console.log('✨ ALL API ENDPOINTS VERIFIED & FULLY FUNCTIONAL! ✨');
      process.exit(0);
    } else {
      console.error('⚠️ SOME TESTS FAILED');
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal Test Runner Error:', err);
    process.exit(1);
  }
}

runTests();

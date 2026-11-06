/**
 * WealthTrack - BDT (৳) Personal Finance Engine
 * Fixed Budget Limit Update & Category Limit Editing
 */

// Application State Management
const state = {
  token: localStorage.getItem('wealth_token') || null,
  user: JSON.parse(localStorage.getItem('wealth_user') || 'null'),
  theme: localStorage.getItem('wealth_theme') || 'dark',
  activeTab: 'dashboard',
  selectedMonth: new Date().toISOString().substring(0, 7), // YYYY-MM
  
  // Data Caches
  analytics: null,
  categories: [],
  transactions: [],
  goals: [],
  pagination: { page: 1, totalPages: 1, total: 0 },
  
  // Active Filters & Modals
  filters: { search: '', type: '', category: '', startDate: '', endDate: '' },
  modal: null, // 'credit', 'debit', 'reset_confirm', 'add_cat', 'edit_cat', 'add_goal', 'deposit_goal', 'profile'
  modalData: null,

  apiBaseUrl: 'http://localhost:5000/api/v1'
};

// Strict BDT Currency Formatter
function formatCurrency(amount) {
  const val = parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `৳ ${val}`;
}

// API Helper
async function apiRequest(endpoint, method = 'GET', data = null) {
  const headers = {};
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  let body = null;
  if (data) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(data);
  }

  try {
    const response = await fetch(`${state.apiBaseUrl}${endpoint}`, { method, headers, body });
    if (response.status === 401) {
      state.token = null;
      state.user = null;
      localStorage.removeItem('wealth_token');
      localStorage.removeItem('wealth_user');
      renderApp();
      return null;
    }
    const resData = await response.json();
    if (!response.ok) throw new Error(resData.error || 'API Request Failed');
    return resData;
  } catch (err) {
    console.warn(`API call failed (${endpoint}). Using local database.`, err.message);
    return handleLocalFallback(endpoint, method, data);
  }
}

// Local Storage Fallback Store (Full PUT Category Limit Fix)
function handleLocalFallback(endpoint, method, data) {
  let db = JSON.parse(localStorage.getItem('wealth_local_db') || 'null');
  if (!db) {
    db = createInitialSeedDb();
    localStorage.setItem('wealth_local_db', JSON.stringify(db));
  }

  if (endpoint.startsWith('/transactions/reset')) {
    db.transactions = [];
    db.goals.forEach(g => { g.current_amount = 0; g.status = 'IN_PROGRESS'; });
    localStorage.setItem('wealth_local_db', JSON.stringify(db));
    return { message: 'All transactions reset to 0 ৳' };
  }

  if (endpoint.startsWith('/auth/login')) {
    return { token: 'demo_token_' + Date.now(), user: db.user };
  }

  if (endpoint.startsWith('/categories')) {
    if (method === 'GET') {
      const month = state.selectedMonth;
      const spendingMap = {};
      db.transactions.forEach(t => {
        if (t.transaction_date.startsWith(month)) {
          spendingMap[t.category_id] = (spendingMap[t.category_id] || 0) + t.amount;
        }
      });
      const enriched = db.categories.map(c => {
        const spent = spendingMap[c.id] || 0;
        const limit = c.budget_limit || 0;
        const remaining = Math.max(0, limit - spent);
        const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
        let alertStatus = 'NORMAL';
        if (pct >= 100) alertStatus = 'EXCEEDED_100';
        else if (pct >= 80) alertStatus = 'WARNING_80';
        return { ...c, spent_amount: spent, remaining_amount: remaining, percentage_used: pct, alert_status: alertStatus };
      });
      return { month, categories: enriched };
    }
    if (method === 'POST') {
      const newCat = { id: 'cat_' + Date.now(), name: data.name, type: data.type, budget_limit: parseFloat(data.budget_limit || 0), icon: data.icon || 'tag', color: data.color || '#ef4444' };
      db.categories.push(newCat);
      localStorage.setItem('wealth_local_db', JSON.stringify(db));
      return newCat;
    }
    if (method === 'PUT') {
      const catId = endpoint.split('/')[2];
      const cat = db.categories.find(c => c.id === catId);
      if (cat) {
        if (data.name) cat.name = data.name;
        if (data.budget_limit !== undefined) cat.budget_limit = parseFloat(data.budget_limit);
        localStorage.setItem('wealth_local_db', JSON.stringify(db));
        return cat;
      }
    }
    if (method === 'DELETE') {
      const catId = endpoint.split('/')[2];
      db.categories = db.categories.filter(c => c.id !== catId);
      db.transactions = db.transactions.filter(t => t.category_id !== catId);
      localStorage.setItem('wealth_local_db', JSON.stringify(db));
      return { message: 'Category deleted' };
    }
  }

  if (endpoint.startsWith('/transactions')) {
    if (method === 'GET') {
      let list = [...db.transactions];
      if (state.filters.type) list = list.filter(t => t.type === state.filters.type);
      if (state.filters.category) list = list.filter(t => t.category_id === state.filters.category);
      if (state.filters.search) {
        const q = state.filters.search.toLowerCase();
        list = list.filter(t => (t.description || '').toLowerCase().includes(q) || (t.category_name || '').toLowerCase().includes(q));
      }
      return { transactions: list, pagination: { total: list.length, page: 1, totalPages: 1 } };
    }
    if (method === 'POST') {
      let cat = db.categories.find(c => c.id === data.category_id);
      if (!cat) {
        cat = db.categories.find(c => c.name.toLowerCase() === (data.category_name || '').toLowerCase());
      }
      if (!cat) {
        cat = { id: 'cat_' + Date.now(), name: data.category_name || 'General', type: data.type, color: data.type === 'INCOME' ? '#10b981' : '#ef4444' };
        db.categories.push(cat);
      }
      const newTx = {
        id: 'tx_' + Date.now(),
        user_id: 'u_demo',
        category_id: cat.id,
        category_name: cat.name,
        category_color: cat.color,
        amount: parseFloat(data.amount),
        type: data.type,
        transaction_date: data.transaction_date,
        description: data.description || '',
        payment_method: data.payment_method || 'Cash'
      };
      db.transactions.unshift(newTx);
      localStorage.setItem('wealth_local_db', JSON.stringify(db));
      return newTx;
    }
    if (method === 'DELETE') {
      const id = endpoint.split('/')[2];
      db.transactions = db.transactions.filter(t => t.id !== id);
      localStorage.setItem('wealth_local_db', JSON.stringify(db));
      return { message: 'Deleted' };
    }
  }

  if (endpoint.startsWith('/goals')) {
    if (method === 'GET') {
      return db.goals.map(g => ({
        ...g,
        remaining_balance: Math.max(0, g.target_amount - g.current_amount),
        percentage_completed: Math.min(100, Math.round((g.current_amount / g.target_amount) * 100))
      }));
    }
    if (method === 'POST') {
      const newGoal = { id: 'goal_' + Date.now(), ...data, current_amount: data.current_amount || 0, status: 'IN_PROGRESS' };
      db.goals.push(newGoal);
      localStorage.setItem('wealth_local_db', JSON.stringify(db));
      return newGoal;
    }
    if (method === 'DELETE') {
      const goalId = endpoint.split('/')[2];
      db.goals = db.goals.filter(g => g.id !== goalId);
      localStorage.setItem('wealth_local_db', JSON.stringify(db));
      return { message: 'Goal deleted' };
    }
    if (method === 'PATCH') {
      const id = endpoint.split('/')[2];
      const goal = db.goals.find(g => g.id === id);
      if (goal) {
        goal.current_amount += parseFloat(data.amount);
        if (goal.current_amount >= goal.target_amount) goal.status = 'COMPLETED';
        localStorage.setItem('wealth_local_db', JSON.stringify(db));
      }
      return { goal };
    }
  }

  if (endpoint.startsWith('/analytics/summary')) {
    const month = state.selectedMonth;
    let creditTotal = 0, debitTotal = 0;
    const catExpenseMap = {};

    db.transactions.forEach(t => {
      if (t.transaction_date.startsWith(month)) {
        if (t.type === 'INCOME') creditTotal += t.amount;
        if (t.type === 'EXPENSE') {
          debitTotal += t.amount;
          catExpenseMap[t.category_name] = (catExpenseMap[t.category_name] || 0) + t.amount;
        }
      }
    });

    const breakdown = Object.keys(catExpenseMap).map(name => ({
      name, amount: catExpenseMap[name], color: '#6366f1'
    }));

    return {
      selected_month: month,
      kpis: {
        total_income: creditTotal,
        total_expenses: debitTotal,
        net_cash_flow: creditTotal - debitTotal,
        savings_rate: creditTotal > 0 ? Math.max(0, Math.round(((creditTotal - debitTotal) / creditTotal) * 100)) : 0
      },
      expense_breakdown: breakdown,
      trend_chart: [
        { month: 'Mar', income: 45000, expense: 28000 },
        { month: 'Apr', income: 52000, expense: 31000 },
        { month: 'May', income: 55000, expense: 30000 },
        { month: 'Jun', income: 60000, expense: 35000 },
        { month: 'Jul', income: 58000, expense: 33000 },
        { month: 'Aug', income: creditTotal, expense: debitTotal }
      ],
      alerts: []
    };
  }

  return {};
}

function createInitialSeedDb() {
  return {
    user: { id: 'u_demo', email: 'demo@wealth.io', preferred_currency: 'BDT', baseline_budget: 50000 },
    categories: [],
    transactions: [],
    goals: []
  };
}

// Data Fetchers
async function fetchAllData() {
  if (!state.token) return;

  const [analyticsRes, categoriesRes, txRes, goalsRes] = await Promise.all([
    apiRequest(`/analytics/summary?month=${state.selectedMonth}`),
    apiRequest(`/categories?month=${state.selectedMonth}`),
    apiRequest(`/transactions?page=${state.pagination.page}&type=${state.filters.type}&category_id=${state.filters.category}&search=${encodeURIComponent(state.filters.search)}`),
    apiRequest('/goals')
  ]);

  if (analyticsRes) state.analytics = analyticsRes;
  if (categoriesRes && categoriesRes.categories) state.categories = categoriesRes.categories;
  if (txRes && txRes.transactions) {
    state.transactions = txRes.transactions;
    if (txRes.pagination) state.pagination = txRes.pagination;
  }
  if (goalsRes) state.goals = goalsRes;
}

// UI Initialization & Render Loop
document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.setAttribute('data-theme', state.theme);
  
  if (!state.token) {
    state.token = 'demo_session_token';
    state.user = { id: 'u_demo', email: 'demo@wealth.io', preferred_currency: 'BDT', baseline_budget: 50000 };
    localStorage.setItem('wealth_token', state.token);
    localStorage.setItem('wealth_user', JSON.stringify(state.user));
  }

  await fetchAllData();
  renderApp();
});

function renderApp() {
  const root = document.getElementById('app');
  if (!root) return;

  root.innerHTML = `
    <div style="min-height: 100vh; display: flex; flex-direction: column;">
      ${renderNavbar()}
      <main style="flex: 1; padding: 1.5rem; max-width: 1300px; margin: 0 auto; width: 100%;">
        ${renderActiveTab()}
      </main>
      ${renderFooter()}
    </div>
    ${renderModalContainer()}
  `;

  if (window.lucide) window.lucide.createIcons();

  attachGlobalEvents();

  if (state.activeTab === 'dashboard' && state.analytics) {
    setTimeout(renderDashboardCharts, 50);
  }
}

// Navigation Header Component
function renderNavbar() {
  return `
    <header class="glass-panel" style="border-radius: 0; border-x: none; border-top: none; position: sticky; top: 0; z-index: 100;">
      <div style="max-width: 1300px; margin: 0 auto; padding: 1rem 1.5rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
        
        <!-- Logo -->
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #10b981, #059669); display: flex; align-items: center; justify-content: center; color: white; font-weight: 800;">
            <i data-lucide="wallet"></i>
          </div>
          <div>
            <h1 style="font-size: 1.25rem; font-weight: 800; letter-spacing: -0.02em; background: linear-gradient(135deg, var(--text-primary), #10b981); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">WealthTrack</h1>
            <p style="font-size: 0.75rem; color: var(--text-secondary);">BDT (৳) Finance Manager</p>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <nav style="display: flex; align-items: center; gap: 0.5rem; background: var(--bg-surface-elevated); padding: 0.25rem; border-radius: 12px; border: 1px solid var(--border-color);">
          <button class="nav-tab ${state.activeTab === 'dashboard' ? 'active' : ''}" data-tab="dashboard">
            <i data-lucide="layout-dashboard"></i> Dashboard
          </button>
          <button class="nav-tab ${state.activeTab === 'transactions' ? 'active' : ''}" data-tab="transactions">
            <i data-lucide="list"></i> History
          </button>
          <button class="nav-tab ${state.activeTab === 'categories' ? 'active' : ''}" data-tab="categories">
            <i data-lucide="pie-chart"></i> Budgets
          </button>
          <button class="nav-tab ${state.activeTab === 'goals' ? 'active' : ''}" data-tab="goals">
            <i data-lucide="target"></i> Savings Goals
          </button>
        </nav>

        <!-- Controls -->
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span class="badge badge-normal" style="padding: 0.5rem 0.75rem; font-size: 0.85rem; border-radius: 8px; font-weight: 800;">
            <i data-lucide="coins"></i> BDT (৳)
          </span>

          <button id="btn-reset-data" class="btn btn-danger" style="padding: 0.5rem 0.85rem; font-size: 0.8rem; font-weight: 700; border-radius: 8px;" title="Reset all transactions to zero">
            <i data-lucide="rotate-ccw"></i> Reset (0 ৳)
          </button>

          <button id="btn-theme-toggle" class="btn btn-secondary" style="padding: 0.5rem; border-radius: 8px;" title="Toggle Theme">
            <i data-lucide="${state.theme === 'dark' ? 'sun' : 'moon'}"></i>
          </button>
        </div>
      </div>
    </header>
  `;
}

function renderActiveTab() {
  switch (state.activeTab) {
    case 'dashboard': return renderDashboardView();
    case 'transactions': return renderTransactionsView();
    case 'categories': return renderCategoriesView();
    case 'goals': return renderGoalsView();
    default: return renderDashboardView();
  }
}

// Simplified Dashboard View
function renderDashboardView() {
  const kpis = state.analytics ? state.analytics.kpis : { total_income: 0, total_expenses: 0, net_cash_flow: 0, savings_rate: 0 };

  return `
    <div style="display: flex; flex-direction: column; gap: 1.75rem;">
      
      <div class="glass-card" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(244, 63, 94, 0.08)); border-color: rgba(255, 255, 255, 0.12); padding: 2rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1.5rem;">
          <div>
            <span class="badge badge-normal" style="margin-bottom: 0.5rem;">Currency: BDT (৳)</span>
            <h2 style="font-size: 1.75rem; font-weight: 800;">Financial Action Hub</h2>
            <p style="font-size: 0.9rem; color: var(--text-secondary);">Select Credit (+) to add income or Debit (-) to record expenses in BDT (৳).</p>
          </div>

          <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
            <button id="btn-credit-action" class="btn" style="padding: 1rem 1.75rem; font-size: 1.1rem; font-weight: 800; background: linear-gradient(135deg, #10b981, #059669); color: white; border-radius: 14px; box-shadow: 0 10px 25px -5px rgba(16, 185, 129, 0.4); border: none; cursor: pointer;">
              <i data-lucide="plus-circle" style="width: 24px; height: 24px;"></i> Credit (+) Income
            </button>

            <button id="btn-debit-action" class="btn" style="padding: 1rem 1.75rem; font-size: 1.1rem; font-weight: 800; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border-radius: 14px; box-shadow: 0 10px 25px -5px rgba(239, 68, 68, 0.4); border: none; cursor: pointer;">
              <i data-lucide="minus-circle" style="width: 24px; height: 24px;"></i> Debit (-) Expense
            </button>

            <button id="btn-reset-hero" class="btn btn-secondary" style="padding: 1rem 1.25rem; font-size: 0.95rem; font-weight: 700; border-radius: 14px;" title="Reset all transactions to zero">
              <i data-lucide="rotate-ccw"></i> Reset (0 ৳)
            </button>
          </div>
        </div>
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between;">
        <h3 style="font-size: 1.25rem; font-weight: 700;">Monthly Overview (BDT ৳)</h3>
        <input type="month" id="month-picker" class="input-field" value="${state.selectedMonth}" style="width: auto; padding: 0.5rem 0.75rem;">
      </div>

      <div class="grid-4">
        <div class="glass-card kpi-card income">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
            <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Total Credit (+)</span>
            <div class="kpi-icon income"><i data-lucide="arrow-down-left"></i></div>
          </div>
          <div style="font-size: 1.75rem; font-weight: 800; color: var(--accent-income);">${formatCurrency(kpis.total_income)}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Added to Income</div>
        </div>

        <div class="glass-card kpi-card expense">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
            <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Total Debit (-)</span>
            <div class="kpi-icon expense"><i data-lucide="arrow-up-right"></i></div>
          </div>
          <div style="font-size: 1.75rem; font-weight: 800; color: var(--accent-expense);">${formatCurrency(kpis.total_expenses)}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Subtracted from Income</div>
        </div>

        <div class="glass-card kpi-card net">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
            <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Net Balance</span>
            <div class="kpi-icon net"><i data-lucide="wallet"></i></div>
          </div>
          <div style="font-size: 1.75rem; font-weight: 800; color: ${kpis.net_cash_flow >= 0 ? 'var(--accent-income)' : 'var(--accent-expense)'};">
            ${formatCurrency(kpis.net_cash_flow)}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Credit - Debit</div>
        </div>

        <div class="glass-card kpi-card savings">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
            <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Savings Rate</span>
            <div class="kpi-icon savings"><i data-lucide="piggy-bank"></i></div>
          </div>
          <div style="font-size: 1.75rem; font-weight: 800; color: var(--accent-cyan);">${kpis.savings_rate}%</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Retained Net Income</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="glass-card">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
            <h3 style="font-size: 1rem; font-weight: 700;">Credit vs. Debit Trend (BDT ৳)</h3>
            <span style="font-size: 0.75rem; color: var(--text-secondary);">Last 6 Months</span>
          </div>
          <div style="height: 260px; position: relative;">
            <canvas id="chart-trend"></canvas>
          </div>
        </div>

        <div class="glass-card">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
            <h3 style="font-size: 1rem; font-weight: 700;">Debit Breakdown by Source (BDT ৳)</h3>
            <span style="font-size: 0.75rem; color: var(--text-secondary);">${state.selectedMonth}</span>
          </div>
          <div style="height: 260px; position: relative;">
            <canvas id="chart-breakdown"></canvas>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Chart.js Renderer
function renderDashboardCharts() {
  if (!state.analytics) return;

  const trendCtx = document.getElementById('chart-trend');
  if (trendCtx && state.analytics.trend_chart) {
    const labels = state.analytics.trend_chart.map(t => t.month);
    const creditData = state.analytics.trend_chart.map(t => t.income);
    const debitData = state.analytics.trend_chart.map(t => t.expense);

    new Chart(trendCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Credit (+)',
            data: creditData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            tension: 0.35,
            fill: true,
            borderWidth: 3
          },
          {
            label: 'Debit (-)',
            data: debitData,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            tension: 0.35,
            fill: true,
            borderWidth: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: state.theme === 'dark' ? '#9ca3af' : '#475569' } }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: state.theme === 'dark' ? '#9ca3af' : '#475569' } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: state.theme === 'dark' ? '#9ca3af' : '#475569' } }
        }
      }
    });
  }

  const breakdownCtx = document.getElementById('chart-breakdown');
  if (breakdownCtx && state.analytics.expense_breakdown) {
    const items = state.analytics.expense_breakdown;
    const labels = items.map(i => i.name);
    const dataVals = items.map(i => i.amount);
    const colors = ['#ec4899', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#6366f1'];

    new Chart(breakdownCtx, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['No Debits Recorded'],
        datasets: [{
          data: dataVals.length ? dataVals : [1],
          backgroundColor: colors,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: state.theme === 'dark' ? '#9ca3af' : '#475569' } }
        },
        cutout: '70%'
      }
    });
  }
}

// Transaction History View
function renderTransactionsView() {
  return `
    <div style="display: flex; flex-direction: column; gap: 1.5rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2 style="font-size: 1.5rem; font-weight: 800;">Transaction History (BDT ৳)</h2>
          <p style="font-size: 0.875rem; color: var(--text-secondary);">Review all Credit (+) and Debit (-) entries.</p>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <button class="btn btn-income" onclick="state.modal = 'credit'; renderApp();"><i data-lucide="plus-circle"></i> Add Credit</button>
          <button class="btn btn-danger" onclick="state.modal = 'debit'; renderApp();"><i data-lucide="minus-circle"></i> Add Debit</button>
          <button class="btn btn-secondary" onclick="state.modal = 'reset_confirm'; renderApp();" title="Reset to 0"><i data-lucide="rotate-ccw"></i> Reset (0 ৳)</button>
        </div>
      </div>

      <div class="glass-card" style="padding: 1rem 1.25rem;">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary);">Search Label / Description</label>
            <input type="text" id="filter-search" class="input-field" placeholder="Search..." value="${state.filters.search}">
          </div>
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary);">Type</label>
            <select id="filter-type" class="select-field">
              <option value="">All Types</option>
              <option value="INCOME" ${state.filters.type === 'INCOME' ? 'selected' : ''}>Credit (+)</option>
              <option value="EXPENSE" ${state.filters.type === 'EXPENSE' ? 'selected' : ''}>Debit (-)</option>
            </select>
          </div>
          <div style="display: flex; align-items: flex-end;">
            <button class="btn btn-secondary" id="btn-reset-filters" style="width: 100%;">Reset Filters</button>
          </div>
        </div>
      </div>

      <div class="glass-card" style="padding: 0; overflow: hidden;">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Source / Label</th>
                <th>Description</th>
                <th>Payment Method</th>
                <th style="text-align: right;">Amount (BDT ৳)</th>
                <th style="text-align: center;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.transactions.length === 0 ? `
                <tr><td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-secondary);">No transaction history found (0.00 ৳).</td></tr>
              ` : state.transactions.map(t => `
                <tr>
                  <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.85rem;">${t.transaction_date}</td>
                  <td>
                    <span class="badge ${t.type === 'INCOME' ? 'badge-income' : 'badge-expense'}">
                      ${t.type === 'INCOME' ? 'Credit (+)' : 'Debit (-)'}
                    </span>
                  </td>
                  <td><strong style="color: var(--text-primary);">${t.category_name || 'General'}</strong></td>
                  <td>${t.description || '-'}</td>
                  <td><span class="badge badge-normal">${t.payment_method || 'Cash'}</span></td>
                  <td style="text-align: right; font-weight: 800; font-family: 'JetBrains Mono', monospace; color: ${t.type === 'INCOME' ? 'var(--accent-income)' : 'var(--accent-expense)'};">
                    ${t.type === 'INCOME' ? '+' : '-'}${formatCurrency(t.amount)}
                  </td>
                  <td style="text-align: center;">
                    <button class="btn btn-secondary btn-sm btn-delete-tx" data-id="${t.id}" style="padding: 0.35rem 0.6rem;" title="Delete Record">
                      <i data-lucide="trash-2"></i>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// Category / Budget View with Working Limit Edit & Delete
function renderCategoriesView() {
  const expenseCategories = state.categories.filter(c => c.type === 'EXPENSE');

  return `
    <div style="display: flex; flex-direction: column; gap: 1.5rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2 style="font-size: 1.5rem; font-weight: 800;">Custom Categories & Spending Caps (BDT ৳)</h2>
          <p style="font-size: 0.875rem; color: var(--text-secondary);">Manage custom categories, edit budget limits, or delete unwanted categories.</p>
        </div>
        <button class="btn btn-primary" onclick="state.modal = 'add_cat'; renderApp();">
          <i data-lucide="plus-circle"></i> Add Custom Category
        </button>
      </div>

      ${expenseCategories.length === 0 ? `
        <div class="glass-card" style="text-align: center; padding: 3.5rem;">
          <i data-lucide="tag" style="font-size: 3rem; margin-bottom: 0.75rem; opacity: 0.4; color: var(--accent-primary);"></i>
          <h3 style="font-size: 1.2rem; font-weight: 800; margin-bottom: 0.25rem;">No Categories Yet</h3>
          <p style="color: var(--text-secondary); margin-bottom: 1.25rem;">Click 'Add Custom Category' above to create your first spending cap.</p>
          <button class="btn btn-primary" onclick="state.modal = 'add_cat'; renderApp();">
            <i data-lucide="plus"></i> Add Custom Category
          </button>
        </div>
      ` : `
        <div class="grid-2">
          ${expenseCategories.map(cat => {
            const spent = cat.spent_amount || 0;
            const limit = cat.budget_limit || 0;
            const pct = cat.percentage_used || 0;
            const isOver = pct >= 100;
            const isWarn = pct >= 80 && pct < 100;

            return `
              <div class="glass-card" style="border-left: 4px solid ${cat.color || '#ef4444'};">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
                  <strong style="font-size: 1.1rem; font-weight: 800;">${cat.name}</strong>
                  <span class="badge ${isOver ? 'badge-expense' : isWarn ? 'badge-warning' : 'badge-normal'}">
                    ${isOver ? 'Exceeded' : isWarn ? '80%+ Alert' : 'Normal'}
                  </span>
                </div>

                <div style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 0.5rem;">
                  <span style="color: var(--text-secondary);">Spent: <strong>${formatCurrency(spent)}</strong></span>
                  <span style="color: var(--text-secondary);">Limit: <strong>${formatCurrency(limit)}</strong></span>
                </div>

                <div class="progress-bar-bg" style="margin-bottom: 1rem;">
                  <div class="progress-bar-fill ${isOver ? 'danger' : isWarn ? 'warning' : 'normal'}" style="width: ${Math.min(100, pct)}%;"></div>
                </div>

                <!-- Category Card Action Buttons (Edit Limit & Delete Category) -->
                <div style="display: flex; align-items: center; justify-content: space-between; pt: 0.5rem; border-top: 1px solid var(--border-color);">
                  <button class="btn btn-secondary btn-sm btn-edit-category" data-id="${cat.id}" style="padding: 0.35rem 0.75rem; font-weight: 700;">
                    <i data-lucide="edit-2"></i> Edit Limit
                  </button>
                  
                  <button class="btn btn-danger btn-sm btn-delete-category" data-id="${cat.id}" data-name="${cat.name}" style="padding: 0.35rem 0.75rem; font-weight: 700;" title="Delete Category">
                    <i data-lucide="trash-2"></i> Delete
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

// Savings Goals View
function renderGoalsView() {
  return `
    <div style="display: flex; flex-direction: column; gap: 1.5rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2 style="font-size: 1.5rem; font-weight: 800;">Savings Goal Tracker (BDT ৳)</h2>
          <p style="font-size: 0.875rem; color: var(--text-secondary);">Create custom savings goals, allocate funds, or delete goals.</p>
        </div>
        <button class="btn btn-primary" onclick="state.modal = 'add_goal'; renderApp();">
          <i data-lucide="target"></i> Create Savings Goal
        </button>
      </div>

      ${state.goals.length === 0 ? `
        <div class="glass-card" style="text-align: center; padding: 3.5rem;">
          <i data-lucide="piggy-bank" style="font-size: 3rem; margin-bottom: 0.75rem; opacity: 0.4; color: var(--accent-cyan);"></i>
          <h3 style="font-size: 1.2rem; font-weight: 800; margin-bottom: 0.25rem;">No Active Savings Goals</h3>
          <p style="color: var(--text-secondary); margin-bottom: 1.25rem;">Create a target goal to start allocating funds.</p>
          <button class="btn btn-primary" onclick="state.modal = 'add_goal'; renderApp();">
            <i data-lucide="plus"></i> Create Savings Goal
          </button>
        </div>
      ` : `
        <div class="grid-2">
          ${state.goals.map(goal => {
            const pct = goal.percentage_completed || Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100));
            return `
              <div class="glass-card">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
                  <h3 style="font-size: 1.15rem; font-weight: 800;">${goal.goal_name}</h3>
                  <span class="badge badge-income">${pct}% Saved</span>
                </div>
                <div style="margin-bottom: 1rem;">
                  <div style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 0.375rem;">
                    <span>Saved: <strong>${formatCurrency(goal.current_amount)}</strong></span>
                    <span>Target: <strong>${formatCurrency(goal.target_amount)}</strong></span>
                  </div>
                  <div class="progress-bar-bg">
                    <div class="progress-bar-fill normal" style="width: ${pct}%;"></div>
                  </div>
                </div>

                <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                  <button class="btn btn-income btn-sm btn-deposit-goal" data-id="${goal.id}" style="flex: 1; padding: 0.4rem 0.75rem;">
                    <i data-lucide="plus-circle"></i> Deposit Funds
                  </button>
                  <button class="btn btn-danger btn-sm btn-delete-goal" data-id="${goal.id}" data-name="${goal.goal_name}" style="padding: 0.4rem 0.75rem;" title="Delete Savings Goal">
                    <i data-lucide="trash-2"></i> Delete Goal
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

// Modal Containers Renderer
function renderModalContainer() {
  if (!state.modal) return '';

  let content = '';
  switch (state.modal) {
    case 'credit': content = renderCreditModal(); break;
    case 'debit': content = renderDebitModal(); break;
    case 'reset_confirm': content = renderResetConfirmModal(); break;
    case 'add_cat': content = renderAddCategoryModal(); break;
    case 'edit_cat': content = renderEditCategoryModal(); break;
    case 'add_goal': content = renderAddGoalModal(); break;
    case 'deposit_goal': content = renderDepositGoalModal(); break;
  }

  return `
    <div class="modal-backdrop active" id="modal-backdrop">
      <div class="modal-dialog">
        ${content}
      </div>
    </div>
  `;
}

// Edit Category Limit Modal
function renderEditCategoryModal() {
  const cat = state.modalData;
  if (!cat) return '';
  return `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem;">
      <h3 style="font-size: 1.25rem; font-weight: 800;">Edit Spending Cap - ${cat.name}</h3>
      <button class="btn btn-secondary btn-close-modal" style="padding: 0.35rem 0.6rem;"><i data-lucide="x"></i></button>
    </div>
    <form id="form-edit-cat" style="display: flex; flex-direction: column; gap: 1.25rem;">
      <div>
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.25rem; display: block;">Category Name</label>
        <input type="text" id="edit-cat-name" class="input-field" value="${cat.name}" required>
      </div>
      <div>
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.25rem; display: block;">Monthly Budget Cap in BDT (৳) <span style="color: #ef4444;">*</span></label>
        <div style="position: relative;">
          <span style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); font-weight: 800; color: var(--accent-primary);">৳</span>
          <input type="number" id="edit-cat-limit" class="input-field" style="padding-left: 2.25rem; font-size: 1.1rem; font-weight: 700;" step="100" min="0" value="${cat.budget_limit || 0}" required autofocus>
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.5rem;">
        <button type="button" class="btn btn-secondary btn-close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary" style="padding: 0.75rem 1.5rem; font-weight: 800;">Save Limit</button>
      </div>
    </form>
  `;
}

// Reset Confirmation Modal
function renderResetConfirmModal() {
  return `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem;">
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(239, 68, 68, 0.15); color: #ef4444; display: flex; align-items: center; justify-content: center;">
          <i data-lucide="alert-triangle"></i>
        </div>
        <h3 style="font-size: 1.25rem; font-weight: 800; color: #ef4444;">Reset All Transactions to Zero</h3>
      </div>
      <button class="btn btn-secondary btn-close-modal" style="padding: 0.35rem 0.6rem;"><i data-lucide="x"></i></button>
    </div>

    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <p style="font-size: 0.95rem; color: var(--text-primary); line-height: 1.5;">
        Are you sure you want to reset all transaction history to <strong>0.00 ৳</strong>?
      </p>
      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
        <button type="button" class="btn btn-secondary btn-close-modal">Cancel</button>
        <button type="button" id="btn-confirm-reset" class="btn btn-danger" style="padding: 0.75rem 1.5rem; font-weight: 800;">
          Yes, Reset All to 0 ৳
        </button>
      </div>
    </div>
  `;
}

// Credit (+) Modal
function renderCreditModal() {
  const today = new Date().toISOString().split('T')[0];
  
  return `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem;">
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(16, 185, 129, 0.15); color: #10b981; display: flex; align-items: center; justify-content: center;">
          <i data-lucide="plus-circle"></i>
        </div>
        <h3 style="font-size: 1.25rem; font-weight: 800; color: #10b981;">Credit (+) Add Income</h3>
      </div>
      <button class="btn btn-secondary btn-close-modal" style="padding: 0.35rem 0.6rem;"><i data-lucide="x"></i></button>
    </div>

    <form id="form-credit" style="display: flex; flex-direction: column; gap: 1.25rem;">
      <div>
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.25rem; display: block;">
          Amount in BDT (৳) <span style="color: #ef4444;">*</span>
        </label>
        <div style="position: relative;">
          <span style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); font-weight: 800; color: #10b981;">৳</span>
          <input type="number" id="credit-amount" class="input-field" style="padding-left: 2.25rem; font-size: 1.1rem; font-weight: 700;" step="1" min="1" placeholder="e.g. 50000" required autofocus>
        </div>
      </div>

      <div>
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.25rem; display: block;">
          Income Source / Label <span style="color: #ef4444;">*</span>
        </label>
        <input type="text" id="credit-source-input" class="input-field" placeholder="e.g. Monthly Salary, Freelance, Business" required>
      </div>

      <div>
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-secondary);">Transaction Date</label>
        <input type="date" id="credit-date" class="input-field" value="${today}" required>
      </div>

      <div>
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-secondary);">Payment Method</label>
        <select id="credit-method" class="select-field">
          <option value="Bank Transfer">Bank Transfer</option>
          <option value="bKash / Nagad">bKash / Mobile Wallet</option>
          <option value="Cash">Cash</option>
          <option value="Card">Card</option>
        </select>
      </div>

      <div>
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-secondary);">Note / Reference (Optional)</label>
        <input type="text" id="credit-desc" class="input-field" placeholder="Optional notes...">
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.5rem;">
        <button type="button" class="btn btn-secondary btn-close-modal">Cancel</button>
        <button type="submit" class="btn" style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 0.75rem 1.5rem; font-weight: 800; border-radius: 10px;">
          Confirm Credit (+)
        </button>
      </div>
    </form>
  `;
}

// Debit (-) Modal
function renderDebitModal() {
  const today = new Date().toISOString().split('T')[0];
  
  return `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem;">
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(239, 68, 68, 0.15); color: #ef4444; display: flex; align-items: center; justify-content: center;">
          <i data-lucide="minus-circle"></i>
        </div>
        <h3 style="font-size: 1.25rem; font-weight: 800; color: #ef4444;">Debit (-) Add Expense</h3>
      </div>
      <button class="btn btn-secondary btn-close-modal" style="padding: 0.35rem 0.6rem;"><i data-lucide="x"></i></button>
    </div>

    <form id="form-debit" style="display: flex; flex-direction: column; gap: 1.25rem;">
      <div>
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.25rem; display: block;">
          Amount in BDT (৳) <span style="color: #ef4444;">*</span>
        </label>
        <div style="position: relative;">
          <span style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); font-weight: 800; color: #ef4444;">৳</span>
          <input type="number" id="debit-amount" class="input-field" style="padding-left: 2.25rem; font-size: 1.1rem; font-weight: 700;" step="1" min="1" placeholder="e.g. 1500" required autofocus>
        </div>
      </div>

      <div>
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.25rem; display: block;">
          Expense Source / Label <span style="color: #ef4444;">*</span>
        </label>
        <input type="text" id="debit-source-input" class="input-field" placeholder="e.g. House Rent, Groceries, Electricity Bill" required>
      </div>

      <div>
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-secondary);">Transaction Date</label>
        <input type="date" id="debit-date" class="input-field" value="${today}" required>
      </div>

      <div>
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-secondary);">Payment Method</label>
        <select id="debit-method" class="select-field">
          <option value="Cash">Cash</option>
          <option value="bKash / Nagad">bKash / Mobile Wallet</option>
          <option value="Card">Credit/Debit Card</option>
          <option value="Bank Transfer">Bank Transfer</option>
        </select>
      </div>

      <div>
        <label style="font-size: 0.85rem; font-weight: 700; color: var(--text-secondary);">Note / Details (Optional)</label>
        <input type="text" id="debit-desc" class="input-field" placeholder="Optional details...">
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.5rem;">
        <button type="button" class="btn btn-secondary btn-close-modal">Cancel</button>
        <button type="submit" class="btn" style="background: linear-gradient(135deg, #ef4444, #dc2626); color: white; padding: 0.75rem 1.5rem; font-weight: 800; border-radius: 10px;">
          Confirm Debit (-)
        </button>
      </div>
    </form>
  `;
}

// Custom Category Modal
function renderAddCategoryModal() {
  return `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem;">
      <h3 style="font-size: 1.25rem; font-weight: 800;">Create Custom Category (BDT ৳)</h3>
      <button class="btn btn-secondary btn-close-modal" style="padding: 0.35rem 0.6rem;"><i data-lucide="x"></i></button>
    </div>
    <form id="form-add-cat" style="display: flex; flex-direction: column; gap: 1rem;">
      <div>
        <label style="font-size: 0.8rem; font-weight: 700;">Category Name</label>
        <input type="text" id="cat-name" class="input-field" placeholder="e.g. Shopping, Utilities, Medical" required>
      </div>
      <div>
        <label style="font-size: 0.8rem; font-weight: 700;">Type</label>
        <select id="cat-type" class="select-field">
          <option value="EXPENSE">Expense Category</option>
          <option value="INCOME">Income Source</option>
        </select>
      </div>
      <div>
        <label style="font-size: 0.8rem; font-weight: 700;">Monthly Budget Cap (BDT ৳)</label>
        <input type="number" id="cat-limit" class="input-field" step="100" min="0" placeholder="e.g. 10000">
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
        <button type="button" class="btn btn-secondary btn-close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary">Create Category</button>
      </div>
    </form>
  `;
}

// Savings Goal Modal
function renderAddGoalModal() {
  return `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem;">
      <h3 style="font-size: 1.25rem; font-weight: 800;">Create Savings Goal (BDT ৳)</h3>
      <button class="btn btn-secondary btn-close-modal" style="padding: 0.35rem 0.6rem;"><i data-lucide="x"></i></button>
    </div>
    <form id="form-add-goal" style="display: flex; flex-direction: column; gap: 1rem;">
      <div>
        <label style="font-size: 0.8rem; font-weight: 700;">Goal Name</label>
        <input type="text" id="goal-name" class="input-field" placeholder="e.g. New Laptop Fund" required>
      </div>
      <div>
        <label style="font-size: 0.8rem; font-weight: 700;">Target Amount (BDT ৳)</label>
        <input type="number" id="goal-target" class="input-field" step="1000" min="1" placeholder="e.g. 50000" required>
      </div>
      <div>
        <label style="font-size: 0.8rem; font-weight: 700;">Initial Saved (BDT ৳)</label>
        <input type="number" id="goal-current" class="input-field" step="500" min="0" value="0">
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
        <button type="button" class="btn btn-secondary btn-close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary">Create Goal</button>
      </div>
    </form>
  `;
}

function renderDepositGoalModal() {
  const goal = state.modalData;
  if (!goal) return '';
  return `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem;">
      <h3 style="font-size: 1.25rem; font-weight: 800;">Deposit to ${goal.goal_name} (BDT ৳)</h3>
      <button class="btn btn-secondary btn-close-modal" style="padding: 0.35rem 0.6rem;"><i data-lucide="x"></i></button>
    </div>
    <form id="form-deposit-goal" style="display: flex; flex-direction: column; gap: 1rem;">
      <div>
        <label style="font-size: 0.8rem; font-weight: 700;">Deposit Amount (BDT ৳)</label>
        <input type="number" id="deposit-amount" class="input-field" step="500" min="1" placeholder="e.g. 5000" required>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
        <button type="button" class="btn btn-secondary btn-close-modal">Cancel</button>
        <button type="submit" class="btn btn-income">Confirm Deposit</button>
      </div>
    </form>
  `;
}

// Global Events Attachment
function attachGlobalEvents() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', async (e) => {
      state.activeTab = e.currentTarget.getAttribute('data-tab');
      await fetchAllData();
      renderApp();
    });
  });

  const monthPicker = document.getElementById('month-picker');
  if (monthPicker) {
    monthPicker.addEventListener('change', async (e) => {
      state.selectedMonth = e.target.value;
      await fetchAllData();
      renderApp();
    });
  }

  // Credit (+) & Debit (-) Buttons
  const btnCredit = document.getElementById('btn-credit-action');
  if (btnCredit) btnCredit.addEventListener('click', () => { state.modal = 'credit'; renderApp(); });

  const btnDebit = document.getElementById('btn-debit-action');
  if (btnDebit) btnDebit.addEventListener('click', () => { state.modal = 'debit'; renderApp(); });

  // Reset Buttons
  const btnResetData = document.getElementById('btn-reset-data');
  if (btnResetData) btnResetData.addEventListener('click', () => { state.modal = 'reset_confirm'; renderApp(); });

  const btnResetHero = document.getElementById('btn-reset-hero');
  if (btnResetHero) btnResetHero.addEventListener('click', () => { state.modal = 'reset_confirm'; renderApp(); });

  // Theme Switcher
  const btnTheme = document.getElementById('btn-theme-toggle');
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('wealth_theme', state.theme);
      document.documentElement.setAttribute('data-theme', state.theme);
      renderApp();
    });
  }

  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', () => { state.modal = null; renderApp(); });
  });

  attachModalForms();
}

function attachModalForms() {
  // Confirm Reset All Transactions
  const btnConfirmReset = document.getElementById('btn-confirm-reset');
  if (btnConfirmReset) {
    btnConfirmReset.addEventListener('click', async () => {
      await apiRequest('/transactions/reset', 'POST');
      state.modal = null;
      await fetchAllData();
      renderApp();
    });
  }

  // Submit Credit (+) Form
  const formCredit = document.getElementById('form-credit');
  if (formCredit) {
    formCredit.addEventListener('submit', async (e) => {
      e.preventDefault();
      const sourceName = document.getElementById('credit-source-input').value.trim();
      const amount = parseFloat(document.getElementById('credit-amount').value);
      const date = document.getElementById('credit-date').value;
      const method = document.getElementById('credit-method').value;
      const desc = document.getElementById('credit-desc').value;

      let cat = state.categories.find(c => c.type === 'INCOME' && c.name.toLowerCase() === sourceName.toLowerCase());
      if (!cat) {
        cat = await apiRequest('/categories', 'POST', { name: sourceName, type: 'INCOME', budget_limit: 0 });
      }

      await apiRequest('/transactions', 'POST', {
        category_id: cat ? cat.id : null,
        category_name: sourceName,
        amount,
        type: 'INCOME',
        transaction_date: date,
        payment_method: method,
        description: desc
      });

      state.modal = null;
      await fetchAllData();
      renderApp();
    });
  }

  // Submit Debit (-) Form
  const formDebit = document.getElementById('form-debit');
  if (formDebit) {
    formDebit.addEventListener('submit', async (e) => {
      e.preventDefault();
      const sourceName = document.getElementById('debit-source-input').value.trim();
      const amount = parseFloat(document.getElementById('debit-amount').value);
      const date = document.getElementById('debit-date').value;
      const method = document.getElementById('debit-method').value;
      const desc = document.getElementById('debit-desc').value;

      let cat = state.categories.find(c => c.type === 'EXPENSE' && c.name.toLowerCase() === sourceName.toLowerCase());
      if (!cat) {
        cat = await apiRequest('/categories', 'POST', { name: sourceName, type: 'EXPENSE', budget_limit: 5000 });
      }

      await apiRequest('/transactions', 'POST', {
        category_id: cat ? cat.id : null,
        category_name: sourceName,
        amount,
        type: 'EXPENSE',
        transaction_date: date,
        payment_method: method,
        description: desc
      });

      state.modal = null;
      await fetchAllData();
      renderApp();
    });
  }

  // Delete Transaction
  document.querySelectorAll('.btn-delete-tx').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      if (confirm('Delete this transaction record?')) {
        await apiRequest(`/transactions/${id}`, 'DELETE');
        await fetchAllData();
        renderApp();
      }
    });
  });

  // Edit Category Buttons Handler
  document.querySelectorAll('.btn-edit-category').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const cat = state.categories.find(c => c.id === id);
      if (cat) {
        state.modal = 'edit_cat';
        state.modalData = cat;
        renderApp();
      }
    });
  });

  // Edit Category Submit Handler
  const formEditCat = document.getElementById('form-edit-cat');
  if (formEditCat) {
    formEditCat.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = state.modalData.id;
      const newName = document.getElementById('edit-cat-name').value.trim();
      const newLimit = parseFloat(document.getElementById('edit-cat-limit').value || 0);

      await apiRequest(`/categories/${id}`, 'PUT', {
        name: newName,
        budget_limit: newLimit
      });

      state.modal = null;
      await fetchAllData();
      renderApp();
    });
  }

  // Delete Category Button Handler
  document.querySelectorAll('.btn-delete-category').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const name = e.currentTarget.getAttribute('data-name');
      if (confirm(`Are you sure you want to delete category "${name}"?`)) {
        await apiRequest(`/categories/${id}`, 'DELETE');
        await fetchAllData();
        renderApp();
      }
    });
  });

  // Delete Goal Button Handler
  document.querySelectorAll('.btn-delete-goal').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const name = e.currentTarget.getAttribute('data-name');
      if (confirm(`Are you sure you want to delete savings goal "${name}"?`)) {
        await apiRequest(`/goals/${id}`, 'DELETE');
        await fetchAllData();
        renderApp();
      }
    });
  });

  // Create Category
  const formAddCat = document.getElementById('form-add-cat');
  if (formAddCat) {
    formAddCat.addEventListener('submit', async (e) => {
      e.preventDefault();
      await apiRequest('/categories', 'POST', {
        name: document.getElementById('cat-name').value,
        type: document.getElementById('cat-type').value,
        budget_limit: parseFloat(document.getElementById('cat-limit').value || 0)
      });
      state.modal = null;
      await fetchAllData();
      renderApp();
    });
  }

  // Deposit Goal
  document.querySelectorAll('.btn-deposit-goal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const goal = state.goals.find(g => g.id === id);
      if (goal) {
        state.modal = 'deposit_goal';
        state.modalData = goal;
        renderApp();
      }
    });
  });

  const formDeposit = document.getElementById('form-deposit-goal');
  if (formDeposit) {
    formDeposit.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = state.modalData.id;
      await apiRequest(`/goals/${id}/deposit`, 'PATCH', {
        amount: parseFloat(document.getElementById('deposit-amount').value),
        log_as_expense: true
      });
      state.modal = null;
      await fetchAllData();
      renderApp();
    });
  }

  // Create Goal
  const formAddGoal = document.getElementById('form-add-goal');
  if (formAddGoal) {
    formAddGoal.addEventListener('submit', async (e) => {
      e.preventDefault();
      await apiRequest('/goals', 'POST', {
        goal_name: document.getElementById('goal-name').value,
        target_amount: parseFloat(document.getElementById('goal-target').value),
        current_amount: parseFloat(document.getElementById('goal-current').value || 0)
      });
      state.modal = null;
      await fetchAllData();
      renderApp();
    });
  }
}

function renderFooter() {
  return `
    <footer style="border-top: 1px solid var(--border-color); padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.8rem;">
      <p>WealthTrack &copy; 2026 - Personal Finance Manager (Strict BDT ৳)</p>
    </footer>
  `;
}

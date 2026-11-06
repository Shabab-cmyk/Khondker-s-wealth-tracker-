const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const dbPath = path.resolve(__dirname, 'database.json');

// Memory Data Store Structure
let data = {
  users: [],
  categories: [],
  transactions: [],
  savings_goals: []
};

// Load data from file on boot
const loadDb = () => {
  try {
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, 'utf8');
      data = JSON.parse(raw);
    }
  } catch (err) {
    console.error('[DB] Error loading database.json, initializing fresh store.', err);
  }
};

// Save data to file
const saveDb = () => {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[DB] Error saving database.json:', err);
  }
};

loadDb();

// Helper functions matching SQLite interface (run, get, all)
const run = async (sql, params = []) => {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  const upper = normalized.toUpperCase();

  if (upper.startsWith('PRAGMA') || upper.startsWith('CREATE TABLE')) {
    return { changes: 0 };
  }

  // RESET ALL USER TRANSACTIONS
  if (upper === 'DELETE FROM TRANSACTIONS WHERE USER_ID = ?' || upper.includes('USER_ID = ?') && upper.startsWith('DELETE FROM TRANSACTIONS WHERE USER_ID')) {
    const userId = params[0];
    const initialLen = data.transactions.length;
    data.transactions = data.transactions.filter(t => t.user_id !== userId);
    data.savings_goals.forEach(g => {
      if (g.user_id === userId) {
        g.current_amount = 0;
        g.status = 'IN_PROGRESS';
      }
    });
    saveDb();
    return { changes: initialLen - data.transactions.length };
  }

  // INSERT INTO USERS
  if (upper.startsWith('INSERT INTO USERS')) {
    const [id, email, password_hash, preferred_currency, baseline_budget] = params;
    const newUser = {
      id,
      email,
      password_hash,
      preferred_currency: 'BDT',
      baseline_budget: baseline_budget !== undefined ? parseFloat(baseline_budget) : 50000,
      created_at: new Date().toISOString()
    };
    data.users.push(newUser);
    saveDb();
    return { id, changes: 1 };
  }

  // UPDATE USERS
  if (upper.startsWith('UPDATE USERS')) {
    const [preferred_currency, baseline_budget, userId] = params;
    const user = data.users.find(u => u.id === userId);
    if (user) {
      user.preferred_currency = 'BDT';
      if (baseline_budget !== undefined) user.baseline_budget = parseFloat(baseline_budget);
      saveDb();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  // INSERT INTO CATEGORIES
  if (upper.startsWith('INSERT INTO CATEGORIES')) {
    const [id, user_id, name, type, budget_limit, icon, color] = params;
    const newCat = {
      id,
      user_id,
      name,
      type,
      budget_limit: parseFloat(budget_limit || 0),
      icon: icon || 'tag',
      color: color || '#3b82f6'
    };
    data.categories.push(newCat);
    saveDb();
    return { id, changes: 1 };
  }

  // UPDATE CATEGORIES
  if (upper.startsWith('UPDATE CATEGORIES')) {
    const [name, type, budget_limit, icon, color, id, user_id] = params;
    const cat = data.categories.find(c => c.id === id && c.user_id === user_id);
    if (cat) {
      if (name) cat.name = name;
      if (type) cat.type = type;
      if (budget_limit !== undefined) cat.budget_limit = parseFloat(budget_limit);
      if (icon) cat.icon = icon;
      if (color) cat.color = color;
      saveDb();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  // DELETE FROM CATEGORIES BY ID & USER_ID
  if (upper.startsWith('DELETE FROM CATEGORIES')) {
    const [id, user_id] = params;
    const initialLen = data.categories.length;
    data.categories = data.categories.filter(c => !(c.id === id && (c.user_id === user_id || !user_id)));
    // Remove transactions linked to this category
    data.transactions = data.transactions.filter(t => t.category_id !== id);
    saveDb();
    return { changes: initialLen - data.categories.length };
  }

  // INSERT INTO TRANSACTIONS
  if (upper.startsWith('INSERT INTO TRANSACTIONS')) {
    const [id, user_id, category_id, amount, type, transaction_date, description, payment_method] = params;
    const newTx = {
      id,
      user_id,
      category_id,
      amount: parseFloat(amount),
      type,
      transaction_date,
      description: description || '',
      payment_method: payment_method || 'Cash',
      created_at: new Date().toISOString()
    };
    data.transactions.push(newTx);
    saveDb();
    return { id, changes: 1 };
  }

  // UPDATE TRANSACTIONS
  if (upper.startsWith('UPDATE TRANSACTIONS')) {
    const [category_id, amount, type, transaction_date, description, payment_method, id, user_id] = params;
    const tx = data.transactions.find(t => t.id === id && t.user_id === user_id);
    if (tx) {
      if (category_id) tx.category_id = category_id;
      if (amount !== undefined) tx.amount = parseFloat(amount);
      if (type) tx.type = type;
      if (transaction_date) tx.transaction_date = transaction_date;
      if (description !== undefined) tx.description = description;
      if (payment_method) tx.payment_method = payment_method;
      saveDb();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  // DELETE SINGLE TRANSACTION BY ID & USER_ID
  if (upper.startsWith('DELETE FROM TRANSACTIONS')) {
    const [id, user_id] = params;
    const initialLen = data.transactions.length;
    data.transactions = data.transactions.filter(t => !(t.id === id && t.user_id === user_id));
    saveDb();
    return { changes: initialLen - data.transactions.length };
  }

  // INSERT INTO SAVINGS_GOALS
  if (upper.startsWith('INSERT INTO SAVINGS_GOALS')) {
    const [id, user_id, goal_name, target_amount, current_amount, target_date, status] = params;
    const newGoal = {
      id,
      user_id,
      goal_name,
      target_amount: parseFloat(target_amount),
      current_amount: parseFloat(current_amount || 0),
      target_date: target_date || null,
      status: status || 'IN_PROGRESS',
      created_at: new Date().toISOString()
    };
    data.savings_goals.push(newGoal);
    saveDb();
    return { id, changes: 1 };
  }

  // UPDATE SAVINGS_GOALS
  if (upper.startsWith('UPDATE SAVINGS_GOALS')) {
    const [current_amount, status, id, user_id] = params;
    const goal = data.savings_goals.find(g => g.id === id && g.user_id === user_id);
    if (goal) {
      if (current_amount !== undefined) goal.current_amount = parseFloat(current_amount);
      if (status) goal.status = status;
      saveDb();
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  // DELETE FROM SAVINGS_GOALS BY ID & USER_ID
  if (upper.startsWith('DELETE FROM SAVINGS_GOALS')) {
    const [id, user_id] = params;
    const initialLen = data.savings_goals.length;
    data.savings_goals = data.savings_goals.filter(g => !(g.id === id && (g.user_id === user_id || !user_id)));
    saveDb();
    return { changes: initialLen - data.savings_goals.length };
  }

  return { changes: 0 };
};

const get = async (sql, params = []) => {
  const rows = await all(sql, params);
  return rows.length > 0 ? rows[0] : null;
};

const all = async (sql, params = []) => {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  const upper = normalized.toUpperCase();

  // USERS QUERIES
  if (upper.includes('FROM USERS')) {
    if (upper.includes('WHERE EMAIL = ?')) {
      const email = params[0];
      return data.users.filter(u => u.email.toLowerCase() === (email || '').toLowerCase()).map(u => ({ ...u, preferred_currency: 'BDT' }));
    }
    if (upper.includes('WHERE ID = ?')) {
      const id = params[0];
      return data.users.filter(u => u.id === id).map(u => ({ ...u, preferred_currency: 'BDT' }));
    }
    return data.users.map(u => ({ ...u, preferred_currency: 'BDT' }));
  }

  // CATEGORIES QUERIES
  if (upper.includes('FROM CATEGORIES') && !upper.includes('JOIN')) {
    let list = [...data.categories];
    if (upper.includes('WHERE ID = ? AND USER_ID = ?')) {
      const [id, uid] = params;
      list = list.filter(c => c.id === id && c.user_id === uid);
    } else if (upper.includes('WHERE ID = ?')) {
      const id = params[0];
      list = list.filter(c => c.id === id);
    } else if (upper.includes('WHERE USER_ID = ?')) {
      const userId = params[0];
      list = list.filter(c => c.user_id === userId);
    }

    if (upper.includes('NAME LIKE ?')) {
      const term = params[1] ? params[1].replace(/%/g, '').toLowerCase() : (params[0] ? params[0].replace(/%/g, '').toLowerCase() : '');
      list = list.filter(c => c.name.toLowerCase().includes(term));
    }
    if (upper.includes('ORDER BY TYPE DESC, NAME ASC')) {
      list.sort((a, b) => b.type.localeCompare(a.type) || a.name.localeCompare(b.name));
    }
    return list;
  }

  // SAVINGS GOALS QUERIES
  if (upper.includes('FROM SAVINGS_GOALS')) {
    let list = [...data.savings_goals];
    if (upper.includes('WHERE ID = ? AND USER_ID = ?')) {
      const [id, uid] = params;
      list = list.filter(g => g.id === id && g.user_id === uid);
    } else if (upper.includes('WHERE ID = ?')) {
      const id = params[0];
      list = list.filter(g => g.id === id);
    } else if (upper.includes('WHERE USER_ID = ?')) {
      const userId = params[0];
      list = list.filter(g => g.user_id === userId);
    }
    return list;
  }

  // CATEGORY SPENDING PER MONTH (Aggregation)
  if (upper.includes('SUM(AMOUNT) AS TOTAL_SPENT') && upper.includes('STRFTIME')) {
    const [userId, targetMonth] = params;
    const groupMap = {};
    data.transactions.forEach(t => {
      if (t.user_id === userId && (t.transaction_date || '').startsWith(targetMonth)) {
        groupMap[t.category_id] = (groupMap[t.category_id] || 0) + t.amount;
      }
    });
    return Object.keys(groupMap).map(catId => ({
      category_id: catId,
      total_spent: groupMap[catId]
    }));
  }

  // CATEGORY BUDGET ALERTS (Aggregation)
  if (upper.includes('BUDGET_LIMIT > 0') && upper.includes('CATEGORYALERTS')) {
    const [targetMonth, userId] = params;
    const userCats = data.categories.filter(c => c.user_id === userId && c.type === 'EXPENSE' && c.budget_limit > 0);
    return userCats.map(c => {
      const spent = data.transactions
        .filter(t => t.user_id === userId && t.category_id === c.id && t.type === 'EXPENSE' && (t.transaction_date || '').startsWith(targetMonth))
        .reduce((sum, t) => sum + t.amount, 0);
      return { id: c.id, name: c.name, budget_limit: c.budget_limit, spent };
    });
  }

  // TOTAL INCOME & EXPENSE ANALYTICS SUMMARY
  if (upper.includes('TOTAL_INCOME') && upper.includes('TOTAL_EXPENSE')) {
    const [userId, targetMonth] = params;
    let total_income = 0;
    let total_expense = 0;
    data.transactions.forEach(t => {
      if (t.user_id === userId && (t.transaction_date || '').startsWith(targetMonth)) {
        if (t.type === 'INCOME') total_income += t.amount;
        if (t.type === 'EXPENSE') total_expense += t.amount;
      }
    });
    return [{ total_income, total_expense }];
  }

  // EXPENSE BREAKDOWN BY CATEGORY
  if (upper.includes('EXPENSE_BREAKDOWN') || (upper.includes('FROM TRANSACTIONS T') && upper.includes('JOIN CATEGORIES C') && upper.includes('GROUP BY C.ID'))) {
    const [userId, targetMonth] = params;
    const catMap = {};
    data.transactions.forEach(t => {
      if (t.user_id === userId && t.type === 'EXPENSE' && (t.transaction_date || '').startsWith(targetMonth)) {
        const cat = data.categories.find(c => c.id === t.category_id);
        if (cat) {
          if (!catMap[cat.id]) {
            catMap[cat.id] = { id: cat.id, name: cat.name, color: cat.color, icon: cat.icon, amount: 0 };
          }
          catMap[cat.id].amount += t.amount;
        }
      }
    });
    const result = Object.values(catMap);
    result.sort((a, b) => b.amount - a.amount);
    return result;
  }

  // TRANSACTIONS COUNT
  if (upper.includes('COUNT(*) AS COUNT')) {
    const [userId] = params;
    let list = data.transactions.filter(t => t.user_id === userId);
    return [{ count: list.length }];
  }

  // TRANSACTIONS SEARCH / EXPORT / LIST / SINGLE GET
  if (upper.includes('FROM TRANSACTIONS')) {
    let list = [...data.transactions];

    if (upper.includes('WHERE T.ID = ?') || upper.includes('WHERE ID = ?')) {
      const txId = params[0];
      list = list.filter(t => t.id === txId);
    } else if (upper.includes('WHERE T.USER_ID = ?') || upper.includes('WHERE USER_ID = ?')) {
      const userId = params[0];
      list = list.filter(t => t.user_id === userId);
    }

    if (upper.includes('T.TYPE = ?')) {
      const typeParam = params.find(p => p === 'INCOME' || p === 'EXPENSE');
      if (typeParam) list = list.filter(t => t.type === typeParam);
    }

    if (upper.includes('T.CATEGORY_ID = ?')) {
      const catParam = params.find((p, idx) => idx > 0 && typeof p === 'string' && p.length > 10 && p !== 'INCOME' && p !== 'EXPENSE');
      if (catParam) list = list.filter(t => t.category_id === catParam);
    }

    if (upper.includes('LIKE ?')) {
      const searchTerm = params.find(p => typeof p === 'string' && p.startsWith('%'));
      if (searchTerm) {
        const clean = searchTerm.replace(/%/g, '').toLowerCase();
        list = list.filter(t => {
          const cat = data.categories.find(c => c.id === t.category_id);
          const catName = cat ? cat.name.toLowerCase() : '';
          return (t.description || '').toLowerCase().includes(clean) || catName.includes(clean) || (t.payment_method || '').toLowerCase().includes(clean);
        });
      }
    }

    // Enrich with Category metadata
    let enriched = list.map(t => {
      const cat = data.categories.find(c => c.id === t.category_id);
      return {
        ...t,
        category_name: cat ? cat.name : 'General',
        category_color: cat ? cat.color : '#6366f1',
        category_icon: cat ? cat.icon : 'tag'
      };
    });

    enriched.sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));

    // Pagination
    if (upper.includes('LIMIT ? OFFSET ?')) {
      const limit = params[params.length - 2];
      const offset = params[params.length - 1];
      if (typeof limit === 'number' && typeof offset === 'number') {
        enriched = enriched.slice(offset, offset + limit);
      }
    }

    return enriched;
  }

  return [];
};

// DB Initialization & Seed Setup (Strict BDT Currency)
const initDb = async () => {
  if (data.users.length === 0) {
    const demoUserId = crypto.randomUUID();
    const hashedPassword = await bcrypt.hash('demo1234', 10);

    data.users.push({
      id: demoUserId,
      email: 'demo@wealth.io',
      password_hash: hashedPassword,
      preferred_currency: 'BDT',
      baseline_budget: 50000.00,
      created_at: new Date().toISOString()
    });

    saveDb();
  }
};

const seedUserDefaultCategories = async (userId) => {
  // Clean initialization - no forced default categories
  saveDb();
};

module.exports = {
  run,
  get,
  all,
  initDb,
  seedUserDefaultCategories
};

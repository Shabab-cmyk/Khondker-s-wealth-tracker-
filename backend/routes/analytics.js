const express = require('express');
const router = express.Router();
const { get, all } = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/v1/analytics/summary?month=YYYY-MM
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    let targetMonth = req.query.month;
    if (!targetMonth) {
      const now = new Date();
      targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Get Total Monthly Income & Expenses
    const totalsRow = await get(`
      SELECT 
        SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END) as total_income,
        SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END) as total_expense
      FROM transactions
      WHERE user_id = ? AND strftime('%Y-%m', transaction_date) = ?
    `, [userId, targetMonth]);

    const totalIncome = totalsRow && totalsRow.total_income ? totalsRow.total_income : 0;
    const totalExpenses = totalsRow && totalsRow.total_expense ? totalsRow.total_expense : 0;
    const netCashFlow = totalIncome - totalExpenses;
    
    // Savings Rate (%) = (Net Cash Flow / Income) * 100 (capped between 0 and 100)
    let savingsRate = 0;
    if (totalIncome > 0) {
      savingsRate = Math.max(0, Math.round(((totalIncome - totalExpenses) / totalIncome) * 100));
    }

    // Expense breakdown by category for pie/donut chart
    const expenseBreakdown = await all(`
      SELECT c.id, c.name, c.color, c.icon, SUM(t.amount) as amount
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE t.user_id = ? AND t.type = 'EXPENSE' AND strftime('%Y-%m', t.transaction_date) = ?
      GROUP BY c.id, c.name, c.color, c.icon
      ORDER BY amount DESC
    `, [userId, targetMonth]);

    // Monthly Trend Line Chart (Last 6 Months)
    // Generate array of last 6 YYYY-MM dates
    const trendMonths = [];
    const [currY, currM] = targetMonth.split('-').map(Number);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currY, currM - 1 - i, 1);
      const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const labelStr = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
      trendMonths.push({ monthStr: mStr, label: labelStr });
    }

    const trendData = [];
    for (const mObj of trendMonths) {
      const row = await get(`
        SELECT 
          SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END) as income,
          SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END) as expense
        FROM transactions
        WHERE user_id = ? AND strftime('%Y-%m', transaction_date) = ?
      `, [userId, mObj.monthStr]);

      trendData.push({
        month: mObj.label,
        monthKey: mObj.monthStr,
        income: row ? (row.income || 0) : 0,
        expense: row ? (row.expense || 0) : 0,
        net: row ? ((row.income || 0) - (row.expense || 0)) : 0
      });
    }

    // Budget Limit Alert check across expense categories
    const categoryAlerts = await all(`
      SELECT c.id, c.name, c.budget_limit, COALESCE(SUM(t.amount), 0) as spent
      FROM categories c
      LEFT JOIN transactions t ON c.id = t.category_id 
        AND t.type = 'EXPENSE' 
        AND strftime('%Y-%m', t.transaction_date) = ?
      WHERE c.user_id = ? AND c.type = 'EXPENSE' AND c.budget_limit > 0
      GROUP BY c.id
    `, [targetMonth, userId]);

    const warnings = [];
    categoryAlerts.forEach(c => {
      const pct = Math.round((c.spent / c.budget_limit) * 100);
      if (pct >= 100) {
        warnings.push({ id: c.id, category: c.name, level: 'DANGER', limit: c.budget_limit, spent: c.spent, percentage: pct });
      } else if (pct >= 80) {
        warnings.push({ id: c.id, category: c.name, level: 'WARNING', limit: c.budget_limit, spent: c.spent, percentage: pct });
      }
    });

    res.json({
      selected_month: targetMonth,
      kpis: {
        total_income: totalIncome,
        total_expenses: totalExpenses,
        net_cash_flow: netCashFlow,
        savings_rate: savingsRate
      },
      expense_breakdown: expenseBreakdown,
      trend_chart: trendData,
      alerts: warnings
    });
  } catch (err) {
    console.error('Analytics summary error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics summary' });
  }
});

module.exports = router;

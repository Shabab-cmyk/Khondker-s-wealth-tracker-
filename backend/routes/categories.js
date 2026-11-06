const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { get, all, run } = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/v1/categories?month=YYYY-MM
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    let targetMonth = req.query.month;
    if (!targetMonth) {
      const now = new Date();
      targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Fetch categories for user
    const categories = await all('SELECT * FROM categories WHERE user_id = ? ORDER BY type DESC, name ASC', [userId]);

    // Calculate spent amount per category for the specified month
    const spendingRows = await all(`
      SELECT category_id, SUM(amount) as total_spent
      FROM transactions
      WHERE user_id = ? AND strftime('%Y-%m', transaction_date) = ?
      GROUP BY category_id
    `, [userId, targetMonth]);

    const spendingMap = {};
    spendingRows.forEach(r => {
      spendingMap[r.category_id] = r.total_spent || 0;
    });

    const enrichedCategories = categories.map(cat => {
      const spent = spendingMap[cat.id] || 0;
      const budgetLimit = cat.budget_limit || 0;
      const remaining = Math.max(0, budgetLimit - spent);
      let percentageUsed = 0;
      let alertStatus = 'NORMAL';

      if (budgetLimit > 0) {
        percentageUsed = Math.round((spent / budgetLimit) * 100);
        if (percentageUsed >= 100) {
          alertStatus = 'EXCEEDED_100';
        } else if (percentageUsed >= 80) {
          alertStatus = 'WARNING_80';
        }
      }

      return {
        ...cat,
        spent_amount: spent,
        remaining_amount: remaining,
        percentage_used: percentageUsed,
        alert_status: alertStatus
      };
    });

    res.json({
      month: targetMonth,
      categories: enrichedCategories
    });
  } catch (err) {
    console.error('Fetch categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST /api/v1/categories
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, type, budget_limit = 0, icon = 'tag', color = '#3b82f6' } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'Category name and type are required' });
    }

    if (!['INCOME', 'EXPENSE'].includes(type.toUpperCase())) {
      return res.status(400).json({ error: 'Type must be INCOME or EXPENSE' });
    }

    const limit = parseFloat(budget_limit);
    if (isNaN(limit) || limit < 0) {
      return res.status(400).json({ error: 'Budget limit must be a non-negative number' });
    }

    const categoryId = crypto.randomUUID();
    await run(
      'INSERT INTO categories (id, user_id, name, type, budget_limit, icon, color) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [categoryId, req.user.id, name.trim(), type.toUpperCase(), limit, icon, color]
    );

    const newCategory = await get('SELECT * FROM categories WHERE id = ?', [categoryId]);
    res.status(201).json({
      ...newCategory,
      spent_amount: 0,
      remaining_amount: limit,
      percentage_used: 0,
      alert_status: 'NORMAL'
    });
  } catch (err) {
    console.error('Create category error:', err);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// PUT /api/v1/categories/:id
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, budget_limit, icon, color } = req.body;

    const existing = await get('SELECT * FROM categories WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const newName = name ? name.trim() : existing.name;
    const newType = type && ['INCOME', 'EXPENSE'].includes(type.toUpperCase()) ? type.toUpperCase() : existing.type;
    const newLimit = budget_limit !== undefined ? Math.max(0, parseFloat(budget_limit)) : existing.budget_limit;
    const newIcon = icon || existing.icon;
    const newColor = color || existing.color;

    await run(
      'UPDATE categories SET name = ?, type = ?, budget_limit = ?, icon = ?, color = ? WHERE id = ?',
      [newName, newType, newLimit, newIcon, newColor, id]
    );

    const updated = await get('SELECT * FROM categories WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    console.error('Update category error:', err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// DELETE /api/v1/categories/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await get('SELECT * FROM categories WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }

    await run('DELETE FROM categories WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ message: 'Category deleted successfully' });
  } catch (err) {
    console.error('Delete category error:', err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;

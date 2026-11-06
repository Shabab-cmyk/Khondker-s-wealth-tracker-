const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const { get, all, run } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

// GET /api/v1/transactions
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate, type, category_id, search, limit = 100, page = 1 } = req.query;

    let query = `
      SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.user_id = ?
    `;
    const params = [userId];

    if (startDate) {
      query += ` AND t.transaction_date >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND t.transaction_date <= ?`;
      params.push(endDate);
    }
    if (type && ['INCOME', 'EXPENSE'].includes(type.toUpperCase())) {
      query += ` AND t.type = ?`;
      params.push(type.toUpperCase());
    }
    if (category_id) {
      query += ` AND t.category_id = ?`;
      params.push(category_id);
    }
    if (search) {
      query += ` AND (t.description LIKE ? OR c.name LIKE ? OR t.payment_method LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    query += ` ORDER BY t.transaction_date DESC, t.created_at DESC`;

    const parsedLimit = parseInt(limit);
    const parsedPage = parseInt(page);
    const offset = (parsedPage - 1) * parsedLimit;

    query += ` LIMIT ? OFFSET ?`;
    params.push(parsedLimit, offset);

    const transactions = await all(query, params);

    let countQuery = `
      SELECT COUNT(*) as count
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.user_id = ?
    `;
    const countParams = [userId];
    const totalCountRow = await get(countQuery, countParams);

    res.json({
      transactions,
      pagination: {
        total: totalCountRow ? totalCountRow.count : 0,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil((totalCountRow ? totalCountRow.count : 0) / parsedLimit)
      }
    });
  } catch (err) {
    console.error('Fetch transactions error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// POST /api/v1/transactions/reset - Reset all transactions to zero
router.post('/reset', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    await run('DELETE FROM transactions WHERE user_id = ?', [userId]);
    res.json({ message: 'All transactions have been reset to 0 ৳ successfully.' });
  } catch (err) {
    console.error('Reset transactions error:', err);
    res.status(500).json({ error: 'Failed to reset transactions' });
  }
});

// GET /api/v1/transactions/export
router.get('/export', authenticateToken, async (req, res) => {
  try {
    const format = (req.query.format || 'csv').toLowerCase();
    const userId = req.user.id;

    const rows = await all(`
      SELECT t.id, t.transaction_date, t.type, c.name as category, t.amount, t.payment_method, t.description
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.user_id = ?
      ORDER BY t.transaction_date DESC
    `, [userId]);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="transactions.json"');
      return res.json(rows);
    } else {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');

      const headers = ['ID', 'Date', 'Type', 'Category', 'Amount (BDT)', 'Payment Method', 'Description'];
      let csvContent = headers.join(',') + '\n';

      rows.forEach(r => {
        const desc = r.description ? `"${r.description.replace(/"/g, '""')}"` : '""';
        const line = [r.id, r.transaction_date, r.type, `"${r.category || 'General'}"`, r.amount, `"${r.payment_method || ''}"`, desc].join(',');
        csvContent += line + '\n';
      });

      return res.send(csvContent);
    }
  } catch (err) {
    console.error('Export transactions error:', err);
    res.status(500).json({ error: 'Failed to export transactions' });
  }
});

// POST /api/v1/transactions - Save every Credit (+) and Debit (-) input permanently
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { category_id, category_name, amount, type, transaction_date, description = '', payment_method = 'Cash' } = req.body;

    if (amount === undefined || !type || !transaction_date) {
      return res.status(400).json({ error: 'Amount, type, and transaction date are required' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number greater than 0' });
    }

    if (!['INCOME', 'EXPENSE'].includes(type.toUpperCase())) {
      return res.status(400).json({ error: 'Type must be INCOME or EXPENSE' });
    }

    let catId = category_id;

    // Auto-create category if category_name is passed and not existing
    if (!catId && category_name) {
      const existingCat = await get('SELECT id FROM categories WHERE user_id = ? AND LOWER(name) = ?', [req.user.id, category_name.toLowerCase().trim()]);
      if (existingCat) {
        catId = existingCat.id;
      } else {
        const newCatId = crypto.randomUUID();
        await run(
          'INSERT INTO categories (id, user_id, name, type, budget_limit, icon, color) VALUES (?, ?, ?, ?, 0, "tag", ?)',
          [newCatId, req.user.id, category_name.trim(), type.toUpperCase(), type.toUpperCase() === 'INCOME' ? '#10b981' : '#ef4444']
        );
        catId = newCatId;
      }
    }

    if (!catId) {
      const fallbackCat = await get('SELECT id FROM categories WHERE user_id = ? AND type = ? LIMIT 1', [req.user.id, type.toUpperCase()]);
      if (fallbackCat) catId = fallbackCat.id;
    }

    const txId = crypto.randomUUID();
    await run(
      `INSERT INTO transactions (id, user_id, category_id, amount, type, transaction_date, description, payment_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [txId, req.user.id, catId, parsedAmount, type.toUpperCase(), transaction_date, description, payment_method]
    );

    const newTx = await get(`
      SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.id = ?
    `, [txId]);

    res.status(201).json(newTx || {
      id: txId,
      user_id: req.user.id,
      category_id: catId,
      amount: parsedAmount,
      type: type.toUpperCase(),
      transaction_date,
      description,
      payment_method
    });
  } catch (err) {
    console.error('Create transaction error:', err);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// DELETE /api/v1/transactions/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await get('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    await run('DELETE FROM transactions WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ message: 'Transaction removed successfully' });
  } catch (err) {
    console.error('Delete transaction error:', err);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

module.exports = router;

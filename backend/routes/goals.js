const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { get, all, run } = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/v1/goals
router.get('/', authenticateToken, async (req, res) => {
  try {
    const goals = await all(
      'SELECT * FROM savings_goals WHERE user_id = ? ORDER BY status ASC, created_at DESC',
      [req.user.id]
    );

    const enrichedGoals = goals.map(g => {
      const remaining = Math.max(0, g.target_amount - g.current_amount);
      const percentage = g.target_amount > 0 ? Math.min(100, Math.round((g.current_amount / g.target_amount) * 100)) : 0;
      
      // Calculate projection based on target_date
      let daysRemaining = null;
      if (g.target_date) {
        const target = new Date(g.target_date);
        const today = new Date();
        const diffTime = target - today;
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }

      return {
        ...g,
        remaining_balance: remaining,
        percentage_completed: percentage,
        days_remaining: daysRemaining
      };
    });

    res.json(enrichedGoals);
  } catch (err) {
    console.error('Fetch savings goals error:', err);
    res.status(500).json({ error: 'Failed to fetch savings goals' });
  }
});

// POST /api/v1/goals
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { goal_name, target_amount, current_amount = 0, target_date } = req.body;

    if (!goal_name || target_amount === undefined) {
      return res.status(400).json({ error: 'Goal name and target amount are required' });
    }

    const target = parseFloat(target_amount);
    if (isNaN(target) || target <= 0) {
      return res.status(400).json({ error: 'Target amount must be a positive number' });
    }

    const current = Math.max(0, parseFloat(current_amount) || 0);
    const status = current >= target ? 'COMPLETED' : 'IN_PROGRESS';
    const goalId = crypto.randomUUID();

    await run(
      `INSERT INTO savings_goals (id, user_id, goal_name, target_amount, current_amount, target_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [goalId, req.user.id, goal_name.trim(), target, current, target_date || null, status]
    );

    const newGoal = await get('SELECT * FROM savings_goals WHERE id = ?', [goalId]);
    res.status(201).json({
      ...newGoal,
      remaining_balance: Math.max(0, target - current),
      percentage_completed: Math.min(100, Math.round((current / target) * 100))
    });
  } catch (err) {
    console.error('Create goal error:', err);
    res.status(500).json({ error: 'Failed to create savings goal' });
  }
});

// PATCH /api/v1/goals/:id/deposit
router.patch('/:id/deposit', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, log_as_expense = false, category_id = null } = req.body;

    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0) {
      return res.status(400).json({ error: 'Deposit amount must be greater than 0' });
    }

    const goal = await get('SELECT * FROM savings_goals WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!goal) {
      return res.status(404).json({ error: 'Savings goal not found' });
    }

    const newCurrent = goal.current_amount + depositAmount;
    const newStatus = newCurrent >= goal.target_amount ? 'COMPLETED' : 'IN_PROGRESS';

    await run(
      'UPDATE savings_goals SET current_amount = ?, status = ? WHERE id = ? AND user_id = ?',
      [newCurrent, newStatus, id, req.user.id]
    );

    // Optionally log this deposit as an expense under a savings category
    if (log_as_expense) {
      let catId = category_id;
      if (!catId) {
        let savingsCat = await get('SELECT id FROM categories WHERE user_id = ? AND name LIKE ?', [req.user.id, '%Savings%']);
        if (!savingsCat) {
          savingsCat = await get('SELECT id FROM categories WHERE user_id = ? AND type = ? LIMIT 1', [req.user.id, 'EXPENSE']);
        }
        if (savingsCat) catId = savingsCat.id;
      }

      if (catId) {
        const todayStr = new Date().toISOString().split('T')[0];
        await run(
          `INSERT INTO transactions (id, user_id, category_id, amount, type, transaction_date, description, payment_method)
           VALUES (?, ?, ?, ?, 'EXPENSE', ?, ?, 'Transfer')`,
          [crypto.randomUUID(), req.user.id, catId, depositAmount, todayStr, `Deposit to ${goal.goal_name}`]
        );
      }
    }

    const updatedGoal = await get('SELECT * FROM savings_goals WHERE id = ?', [id]);
    const remaining = Math.max(0, updatedGoal.target_amount - updatedGoal.current_amount);
    const percentage = Math.min(100, Math.round((updatedGoal.current_amount / updatedGoal.target_amount) * 100));

    res.json({
      message: `Deposited $${depositAmount.toFixed(2)} to ${updatedGoal.goal_name}`,
      goal: {
        ...updatedGoal,
        remaining_balance: remaining,
        percentage_completed: percentage
      }
    });
  } catch (err) {
    console.error('Deposit error:', err);
    res.status(500).json({ error: 'Failed to deposit into savings goal' });
  }
});

// DELETE /api/v1/goals/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await get('SELECT * FROM savings_goals WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Savings goal not found' });
    }

    await run('DELETE FROM savings_goals WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ message: 'Savings goal removed successfully' });
  } catch (err) {
    console.error('Delete goal error:', err);
    res.status(500).json({ error: 'Failed to delete savings goal' });
  }
});

module.exports = router;

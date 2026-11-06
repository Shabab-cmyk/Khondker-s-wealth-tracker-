const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { get, run, seedUserDefaultCategories } = require('../db');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

// POST /api/v1/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, preferred_currency = 'USD', baseline_budget = 5000 } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const existingUser = await get('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    const userId = crypto.randomUUID();
    const password_hash = await bcrypt.hash(password, 10);

    await run(
      'INSERT INTO users (id, email, password_hash, preferred_currency, baseline_budget) VALUES (?, ?, ?, ?, ?)',
      [userId, email.toLowerCase().trim(), password_hash, preferred_currency, baseline_budget]
    );

    // Seed default categories for new user
    await seedUserDefaultCategories(userId);

    const token = jwt.sign({ id: userId, email: email.toLowerCase().trim() }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: userId,
        email: email.toLowerCase().trim(),
        preferred_currency,
        baseline_budget
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        preferred_currency: user.preferred_currency,
        baseline_budget: user.baseline_budget,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// GET /api/v1/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await get('SELECT id, email, preferred_currency, baseline_budget, created_at FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    console.error('Fetch me error:', err);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// PUT /api/v1/auth/profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { preferred_currency, baseline_budget } = req.body;

    if (baseline_budget !== undefined && (isNaN(baseline_budget) || baseline_budget < 0)) {
      return res.status(400).json({ error: 'Baseline budget must be a positive number' });
    }

    const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newCurrency = preferred_currency || user.preferred_currency;
    const newBudget = baseline_budget !== undefined ? parseFloat(baseline_budget) : user.baseline_budget;

    await run(
      'UPDATE users SET preferred_currency = ?, baseline_budget = ? WHERE id = ?',
      [newCurrency, newBudget, req.user.id]
    );

    const updatedUser = await get('SELECT id, email, preferred_currency, baseline_budget, created_at FROM users WHERE id = ?', [req.user.id]);
    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db');

const authRoutes = require('./routes/auth');
const categoriesRoutes = require('./routes/categories');
const transactionsRoutes = require('./routes/transactions');
const goalsRoutes = require('./routes/goals');
const analyticsRoutes = require('./routes/analytics');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON body parser
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize DB schema & seed data
initDb()
  .then(() => {
    console.log('[DB] Database initialized successfully.');
  })
  .catch((err) => {
    console.error('[DB] Database initialization error:', err);
  });

// Health check endpoint
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API v1 Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/categories', categoriesRoutes);
app.use('/api/v1/transactions', transactionsRoutes);
app.use('/api/v1/goals', goalsRoutes);
app.use('/api/v1/analytics', analyticsRoutes);

// Serve static frontend in production if built
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
      if (err) {
        res.status(404).send('API Server Running. Frontend build not found.');
      }
    });
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`[SERVER] Personal Finance API running on http://localhost:${PORT}`);
});

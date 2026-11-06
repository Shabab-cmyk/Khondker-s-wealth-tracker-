# WealthTrack - Personal Finance & Wealth Tracker Engine

A full-stack personal finance and wealth management system built according to the Software Requirements Specification (SRS).

## Features

- **Module A: User Authentication & Profile**: JWT token-based auth with bcrypt password hashing, currency selection (USD, EUR, GBP, JPY, CAD, AUD, INR, BDT), baseline monthly budget setup.
- **Module B: Transaction Engine**: CRUD operations for Income & Expenses, payment method tracking, search & filters, CSV & JSON export/import.
- **Module C: Budgeting & Category Management**: Custom categories with spending limits, real-time spent vs. remaining tracking, visual alerts at 80% (Warning) and 100% (Exceeded cap).
- **Module D: Savings Goal Tracker**: Goal targets with target dates, visual completion progress bars, remaining balance calculations, deposit allocation system.
- **Module E: Analytics & Dashboard Metrics**: KPI cards (Total Income, Total Expenses, Net Cash Flow, Savings Rate %), Chart.js Monthly Trend line chart, Expense Category breakdown donut chart.

## Directory Structure

```
CRM/
├── backend/
│   ├── db.js                 # SQLite schema & auto-seeding script
│   ├── server.js             # Express API server (Port 5000)
│   ├── middleware/auth.js    # JWT authentication middleware
│   ├── routes/               # Auth, Categories, Transactions, Goals, Analytics routes
│   └── test_api.js           # Automated API test suite
├── frontend/
│   ├── index.html            # Main single page application HTML
│   ├── style.css             # Glassmorphism dark/light CSS design system
│   └── app.js                # React/Vanilla SPA engine with Chart.js
```

## Running the Application

### 1. Backend Server
```bash
cd backend
node server.js
```
The REST API runs on `http://localhost:5000/api/v1`.

### 2. Frontend Interface
Open `frontend/index.html` directly in any web browser, or serve it using any HTTP static server (such as `npx serve frontend` or via Express static serving).

### 3. Automated API Verification
```bash
cd backend
node test_api.js
```

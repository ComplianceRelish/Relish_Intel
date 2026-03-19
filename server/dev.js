// ═══════════════════════════════════════════════════════════
// Local Development Server
// Wraps Vercel-style serverless functions in Express
// Run: node server/dev.js
// ═══════════════════════════════════════════════════════════

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

// Import Vercel-style handlers
import claudeHandler from '../api/claude.js';
import comtradeHandler from '../api/comtrade.js';
import comtradeRefHandler from '../api/comtrade-ref.js';
import healthHandler from '../api/health.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use('/api', (req, _res, next) => {
  console.log(`[API] ${req.method} ${req.originalUrl}`);
  next();
});

// Mount API routes — same signature as Vercel serverless functions
app.all('/api/claude', (req, res) => claudeHandler(req, res));
app.all('/api/comtrade', (req, res) => comtradeHandler(req, res));
app.all('/api/comtrade-ref', (req, res) => comtradeRefHandler(req, res));
app.all('/api/health', (req, res) => healthHandler(req, res));

// Catch-all for unknown API routes
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Start server
const PORT = process.env.API_PORT || 3001;
const server = app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║  Relish Market Intelligence — API Server     ║');
  console.log(`  ║  http://localhost:${PORT}                       ║`);
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('  Configured sources:');
  console.log(`    Claude AI:      ${process.env.ANTHROPIC_API_KEY ? '✓ Ready' : '✗ MISSING — add ANTHROPIC_API_KEY to .env'}`);
  console.log(`    Comtrade:       ${process.env.COMTRADE_API_KEY ? '✓ Premium' : '○ Free tier (500 records/call)'}`);
  console.log(`    Supabase:       ${process.env.VITE_SUPABASE_URL ? '✓ Connected' : '○ Not configured'}`);
  console.log(`    Volza:          ${process.env.VOLZA_API_KEY ? '✓' : '○'}`);
  console.log(`    Zauba:          ${process.env.ZAUBA_API_KEY ? '✓' : '○'}`);
  console.log(`    ChemAnalyst:    ${process.env.CHEMANALYST_API_KEY ? '✓' : '○'}`);
  console.log(`    ECHEMI:         ${process.env.ECHEMI_API_KEY ? '✓' : '○'}`);
  console.log('');
  console.log('  Vite frontend → http://localhost:5173');
  console.log('  API requests proxied from Vite → here');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\n  ✓ API server already running on port ${PORT} — reusing it.\n`);
    process.exit(0); // Exit cleanly so concurrently keeps Vite running
  }
  throw err;
});

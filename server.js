'use strict';

const express = require('express');
const path = require('path');
const { scrapeAllBrands } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// GET /api/scrape          – return cached data (or scrape if cache is cold)
// GET /api/scrape?force=1  – force a fresh scrape
app.get('/api/scrape', async (req, res) => {
  const force = req.query.force === '1' || req.query.force === 'true';
  try {
    const result = await scrapeAllBrands(force);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[server] scrape error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Watch Aggregator running → http://localhost:${PORT}`);
  console.log('  GET /api/scrape          (cached)');
  console.log('  GET /api/scrape?force=1  (fresh scrape)');
});

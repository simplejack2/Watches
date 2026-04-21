'use strict';

// Local development server.
// Serves index.html and intercepts /data.json to run the live scraper.
// On GitHub Pages the static data.json file is served directly.

const express = require('express');
const path    = require('path');
const { scrapeAllBrands } = require('./scraper');

const app  = express();
const PORT = process.env.PORT || 3000;

// Dynamic data endpoint — runs Playwright scraper on demand.
// Pass ?force=1 to bypass the in-memory cache.
app.get('/data.json', async (req, res) => {
  const force = req.query.force === '1';
  try {
    const { brands, cachedAt } = await scrapeAllBrands(force);
    res.json({ generatedAt: cachedAt, brands });
  } catch (err) {
    console.error('[server] scrape error:', err);
    res.status(500).json({ generatedAt: null, brands: [], error: err.message });
  }
});

// Serve index.html for every other route
app.use(express.static(path.join(__dirname), {
  index: 'index.html',
  // Don't expose server-side source files
  setHeaders(res, filePath) {
    const blocked = ['server.js', 'scraper.js', 'generate.js'];
    if (blocked.some(f => filePath.endsWith(f))) {
      res.status(403).end();
    }
  },
}));

app.listen(PORT, () => {
  console.log(`Watch Aggregator → http://localhost:${PORT}`);
  console.log('  /data.json          (cached scrape)');
  console.log('  /data.json?force=1  (fresh scrape)');
});

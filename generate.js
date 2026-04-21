'use strict';

// Runs the scraper once and writes data.json to the repo root.
// Used by the GitHub Actions workflow and can be run locally:
//   node generate.js

const fs   = require('fs');
const path = require('path');
const { scrapeAllBrands } = require('./scraper');

(async () => {
  console.log('[generate] scraping all brands…');
  const { brands } = await scrapeAllBrands(true);

  const output = {
    generatedAt: new Date().toISOString(),
    brands,
  };

  const dest = path.join(__dirname, 'data.json');
  fs.writeFileSync(dest, JSON.stringify(output, null, 2), 'utf8');

  console.log('[generate] wrote', dest);
  brands.forEach(b => {
    const status = b.error ? `ERROR: ${b.error}` : `${b.count} listing(s)`;
    console.log(`  ${b.name}: ${status}`);
  });
})().catch(err => {
  console.error('[generate] fatal:', err);
  process.exit(1);
});

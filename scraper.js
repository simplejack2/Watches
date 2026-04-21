'use strict';

const { chromium } = require('playwright');

const BRANDS = [
  { name: 'A. Lange & Söhne', slug: 'a.+lange+%26+sohne' },
  { name: 'Breitling',         slug: 'breitling' },
  { name: 'Jaeger-LeCoultre',  slug: 'jaeger-lecoultre' },
  { name: 'Omega',             slug: 'omega' },
];

const BASE_URL = 'https://www.watchrecon.com';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let _cache = { data: null, ts: 0 };

async function _makeBrowser() {
  return chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });
}

async function _makePage(browser) {
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    },
  });

  // Hide playwright's webdriver fingerprint
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  });

  return ctx.newPage();
}

// Extract listings from the current Playwright page.
// Tries a table-row strategy first, then falls back to card selectors.
async function _extract(page) {
  return page.evaluate(() => {
    const results = [];
    const seen = new Set();

    const abs = href => {
      if (!href) return null;
      if (href.startsWith('//')) return 'https:' + href;
      if (href.startsWith('/')) return 'https://www.watchrecon.com' + href;
      return href;
    };

    const clean = el => (el ? el.textContent.trim() : '');

    // ── Strategy 1: table rows ──────────────────────────────────────────────
    document.querySelectorAll('table tr').forEach(row => {
      const anchors = Array.from(row.querySelectorAll('a[href]'));
      if (!anchors.length) return;

      // Prefer external (off-site) links; fall back to any link
      const link =
        anchors.find(a => {
          const h = a.getAttribute('href') || '';
          return (
            h.startsWith('http') &&
            !h.includes('watchrecon.com') &&
            !h.startsWith('javascript')
          );
        }) || anchors[0];

      const href = abs(link.getAttribute('href'));
      if (!href || seen.has(href)) return;
      seen.add(href);

      const cells = Array.from(row.querySelectorAll('td')).map(clean);

      const price =
        cells.find(t => /[$€£][\d,. ]+|[\d,.]+\s*[$€£]/.test(t)) || '';
      const date =
        cells.find(t =>
          /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d+\s*(sec|min|hr|hour|day|week|month)s?\s*ago/i.test(
            t
          )
        ) || '';
      const source =
        cells.find(
          t =>
            /(watchuseek|reddit|timezone|chrono24|forums?\.|\.com)/i.test(t) &&
            t.length < 60 &&
            !t.includes('$')
        ) || '';

      results.push({
        title: clean(link) || cells[0] || '(no title)',
        url: href,
        price,
        date,
        source,
      });
    });

    if (results.length > 0) return results;

    // ── Strategy 2: card / div listings ────────────────────────────────────
    const cardSelectors = [
      '[class*="result"]',
      '[class*="listing"]',
      '[class*="watch-item"]',
      '[class*="item"]',
      'article',
      '.row',
    ];

    for (const sel of cardSelectors) {
      const cards = document.querySelectorAll(sel);
      if (cards.length < 2) continue;

      cards.forEach(card => {
        const link = card.querySelector('a[href]');
        if (!link) return;
        const href = abs(link.getAttribute('href'));
        if (!href || seen.has(href)) return;
        seen.add(href);

        results.push({
          title: clean(link) || '(no title)',
          url: href,
          price: clean(card.querySelector('[class*="price"]')),
          date: clean(card.querySelector('[class*="date"], time')),
          source: clean(card.querySelector('[class*="source"],[class*="forum"],[class*="site"]')),
        });
      });

      if (results.length > 0) break;
    }

    return results;
  });
}

async function scrapeBrand(page, brand) {
  const url = `${BASE_URL}/?brand=${brand.slug}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  // Give JS-rendered content a moment to paint
  await page.waitForTimeout(2500);
  return _extract(page);
}

/**
 * Scrape all four brands. Results are cached for CACHE_TTL_MS.
 * Pass force=true to bypass the cache.
 */
async function scrapeAllBrands(force = false) {
  if (!force && _cache.data && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return { brands: _cache.data, fromCache: true, cachedAt: new Date(_cache.ts).toISOString() };
  }

  const browser = await _makeBrowser();
  const page = await _makePage(browser);

  const brands = [];

  for (const brand of BRANDS) {
    console.log(`[scraper] scraping ${brand.name} …`);
    let listings = [];
    let error = null;

    try {
      listings = await scrapeBrand(page, brand);
      console.log(`[scraper]   → ${listings.length} listing(s)`);
    } catch (err) {
      error = err.message;
      console.error(`[scraper]   ✗ ${err.message}`);
    }

    brands.push({
      name: brand.name,
      url: `${BASE_URL}/?brand=${brand.slug}`,
      listings,
      count: listings.length,
      scrapedAt: new Date().toISOString(),
      error,
    });
  }

  await browser.close();

  _cache = { data: brands, ts: Date.now() };
  return { brands, fromCache: false, cachedAt: new Date(_cache.ts).toISOString() };
}

module.exports = { scrapeAllBrands, BRANDS };

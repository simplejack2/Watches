'use strict';

const { chromium } = require('playwright');

// Brand values are the exact `brand` query params watchrecon.com understands.
const BRANDS = [
  { name: 'A. Lange & Söhne', brand: 'a. lange & sohne' },
  { name: 'Breitling',         brand: 'breitling' },
  { name: 'Jaeger-LeCoultre',  brand: 'jaeger-lecoultre' },
  { name: 'Omega',             brand: 'omega' },
];

const BASE_URL = 'https://www.watchrecon.com';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PER_BRAND = 80;

let _cache = { data: null, ts: 0 };

function brandUrl(brand) {
  // URLSearchParams encodes spaces as '+' and '&' as %26 — matches watchrecon.
  return `${BASE_URL}/?${new URLSearchParams({ brand }).toString()}`;
}

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
    },
  });

  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  });

  return ctx.newPage();
}

// Extract listings from watchrecon's gallery view.
// Structure (confirmed against the live page):
//   .galleryItemContainer
//     a.listingLink[href]                 -> external listing URL + thumbnail
//     .subjectInfo a[data-original-title] -> full title
//     .priceInfo / .brandInfo / .modelInfo
//     .postDateInfo / .sourceInfo / .userNameInfo a
//     a[href*="detail.php"]               -> watchrecon detail permalink
async function _extract(page) {
  return page.evaluate(base => {
    const clean = s => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const abs = href => {
      if (!href) return null;
      if (href.startsWith('http')) return href;
      if (href.startsWith('//')) return 'https:' + href;
      if (href.startsWith('/')) return base + href;
      return base + '/' + href.replace(/^\.\//, '');
    };
    const text = (el, sel) => clean(el.querySelector(sel)?.textContent);

    const items = [];
    const seen = new Set();

    document.querySelectorAll('.galleryItemContainer').forEach(card => {
      const link = card.querySelector('a.listingLink[href]');
      const href = link && link.getAttribute('href');
      if (!href || seen.has(href)) return;
      seen.add(href);

      const titleEl = card.querySelector('.subjectInfo a.listingLink') || link;
      const title =
        clean(titleEl.getAttribute('data-original-title') || titleEl.textContent) ||
        '(untitled listing)';

      const thumbEl = card.querySelector('img.thumb');
      const detailEl = card.querySelector('a[href*="detail.php"]');

      items.push({
        title,
        url: href,                                  // direct off-site listing link
        price: text(card, '.priceInfo'),
        brand: text(card, '.brandInfo'),
        model: text(card, '.modelInfo'),
        date: text(card, '.postDateInfo'),
        source: text(card, '.sourceInfo').replace(/^on\s+/i, ''),
        seller: text(card, '.userNameInfo a'),
        thumb: thumbEl ? abs(thumbEl.getAttribute('src')) : null,
        detailUrl: detailEl ? abs(detailEl.getAttribute('href')) : null,
      });
    });

    return items;
  }, BASE_URL);
}

async function scrapeBrand(page, brand) {
  const url = brandUrl(brand.brand);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Wait for listings to render; if none appear, treat as zero results.
  try {
    await page.waitForSelector('.galleryItemContainer', { timeout: 15000 });
  } catch {
    return [];
  }

  const listings = await _extract(page);
  return listings.slice(0, MAX_PER_BRAND);
}

/**
 * Scrape all brands. Results cached for CACHE_TTL_MS unless force=true.
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
      url: brandUrl(brand.brand),
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

module.exports = { scrapeAllBrands, BRANDS, brandUrl };

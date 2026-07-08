'use strict';

// Diagnostic probe — runs on the GitHub Actions runner (which can reach
// watchrecon.com) and dumps everything we need to fix the scraper.
// Logs are read back via the GitHub Actions job logs.

const { chromium } = require('playwright');
const fs = require('fs');

const BRAND_URL = 'https://www.watchrecon.com/?brand=omega';

function line(s = '') { console.log(s); }
function hr(t)  { console.log('\n========== ' + t + ' =========='); }

async function probeRss() {
  hr('RSS / FEED PROBES');
  const candidates = [
    'https://www.watchrecon.com/rss?query=omega',
    'https://www.watchrecon.com/rss.php?query=omega',
    'https://www.watchrecon.com/?brand=omega&rss=1',
    'https://www.watchrecon.com/feed?brand=omega',
    'https://www.watchrecon.com/rss?brand=omega',
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0 Safari/537.36' },
      });
      const ct = res.headers.get('content-type') || '';
      const body = await res.text();
      const isXml = /<rss|<feed|<\?xml|<item>/i.test(body.slice(0, 2000));
      line(`[rss] ${url}`);
      line(`      status=${res.status} ct=${ct} len=${body.length} looksXml=${isXml}`);
      if (isXml) line('      SAMPLE: ' + body.slice(0, 400).replace(/\s+/g, ' '));
    } catch (e) {
      line(`[rss] ${url} -> ERROR ${e.message}`);
    }
  }
}

async function probeBrowser() {
  hr('BROWSER PROBE');
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  });
  const page = await ctx.newPage();

  // Capture network responses — reveals any JSON/AJAX API behind the listings
  const apiHits = [];
  page.on('response', resp => {
    const url = resp.url();
    const ct = (resp.headers()['content-type'] || '');
    if (/json|api|search|ajax|query/i.test(url) || ct.includes('json')) {
      apiHits.push({ url: url.slice(0, 160), status: resp.status(), ct });
    }
  });

  line('goto ' + BRAND_URL);
  const resp = await page.goto(BRAND_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  line('initial status=' + (resp && resp.status()));
  line('final url=' + page.url());

  // Wait for network to settle, then extra time for JS rendering
  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch { line('(networkidle timeout)'); }
  await page.waitForTimeout(4000);

  line('title=' + (await page.title()));

  const stats = await page.evaluate(() => {
    const q = s => document.querySelectorAll(s).length;
    const extAnchors = Array.from(document.querySelectorAll('a[href]'))
      .filter(a => { const h = a.getAttribute('href') || ''; return h.startsWith('http') && !h.includes('watchrecon.com'); });
    return {
      bodyTextLen: document.body.innerText.length,
      bodyHtmlLen: document.body.innerHTML.length,
      tables: q('table'), trs: q('tr'), tds: q('td'),
      anchors: q('a[href]'), extAnchors: extAnchors.length,
      imgs: q('img'), divs: q('div'), articles: q('article'), lis: q('li'),
      // class names that appear most often (top 15) — helps find listing containers
      topClasses: (() => {
        const counts = {};
        document.querySelectorAll('[class]').forEach(el => {
          el.classList.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
        });
        return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20)
          .map(([c, n]) => `${c}(${n})`);
      })(),
    };
  });
  line('STATS: ' + JSON.stringify(stats, null, 2));

  // Body innerText sample — tells us if listings are present as text
  const textSample = await page.evaluate(() => document.body.innerText.slice(0, 1200));
  hr('BODY TEXT SAMPLE (1200)');
  line(textSample);

  // Find the most repeated element structure that contains an external link —
  // likely the listing row/card. Dump its outerHTML.
  hr('LISTING CANDIDATE OUTERHTML');
  const candidate = await page.evaluate(() => {
    // Find external anchors, walk up to a reasonable container, return outerHTML of first few
    const ext = Array.from(document.querySelectorAll('a[href]'))
      .filter(a => { const h = a.getAttribute('href') || ''; return h.startsWith('http') && !h.includes('watchrecon.com'); });
    if (!ext.length) return '(no external anchors found)';
    const results = [];
    for (const a of ext.slice(0, 3)) {
      let el = a;
      for (let i = 0; i < 3 && el.parentElement; i++) el = el.parentElement;
      results.push(el.outerHTML.slice(0, 800));
    }
    return results.join('\n\n----\n\n');
  });
  line(candidate);

  hr('API / JSON RESPONSES SEEN');
  if (apiHits.length === 0) line('(none)');
  apiHits.slice(0, 20).forEach(h => line(`${h.status} ${h.ct}  ${h.url}`));

  // Save full HTML as an artifact for offline inspection
  const html = await page.content();
  fs.writeFileSync('page.html', html);
  line('\nFull HTML written to page.html (len ' + html.length + ')');

  await browser.close();
}

(async () => {
  await probeRss();
  await probeBrowser();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

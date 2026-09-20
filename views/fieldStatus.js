const cheerio = require('cheerio');

// The FLL website's field status widget blocks requests with no/unusual User-Agent.
const SOURCE_URL = 'https://www.fairportlittleleague.org/Default.aspx?tabid=1816122';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cache = null; // { data, fetchedAt }

// Only these fields are relevant for FLL; the source page also lists
// non-field entries (photo spots, cage reservations, TBD, etc).
const INCLUDED_PREFIXES = ['Lyndon', 'Cage', 'Home Run Grill'];

async function getFieldStatus() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Field status page returned HTTP ${res.status}`);
  }
  const html = await res.text();
  const data = parseFieldStatus(html);

  cache = { data, fetchedAt: Date.now() };
  return data;
}

// The widget marks each facility/field with an "fs-open" or "fs-close" class.
function parseFieldStatus(html) {
  const $ = cheerio.load(html);

  const facility = $('.fs-item')
    .filter((i, el) => $(el).find('.fs-name').first().text().trim() === 'FLL')
    .first();

  if (facility.length === 0) {
    throw new Error('Could not find the FLL section on the field status page');
  }

  const lastUpdated = facility.find('.fs-time').first().text().trim().replace(/^\(|\)$/g, '').trim();

  const fields = facility
    .find('.fs-detail > div')
    .map((i, el) => {
      const $el = $(el);
      return {
        name: $el.find('.fs-dt-head').first().text().trim(),
        open: !$el.hasClass('fs-dt-close'),
      };
    })
    .get()
    .filter((f) => f.name && INCLUDED_PREFIXES.some((prefix) => f.name.startsWith(prefix)));

  return { fields, lastUpdated };
}

module.exports = { getFieldStatus, SOURCE_URL };

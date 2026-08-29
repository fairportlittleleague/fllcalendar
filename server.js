const express = require('express');
const ical = require('node-ical');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isSameOrAfter = require('dayjs/plugin/isSameOrAfter');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
const { renderPage } = require('./views/calendar');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

// Feed times are treated as UTC and displayed in America/New_York time.
const EASTERN_TZ = 'America/New_York';
function todayEastern() {
  return dayjs.utc().tz(EASTERN_TZ).startOf('day');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Requests/fetches slower than this get flagged with a [perf][slow] warning.
const SLOW_MS = 1000;

// Default feed can be set via env var; users can also override with ?ical=<url>
const DEFAULT_ICAL_URL = process.env.ICAL_URL || '';

app.use('/public', express.static(__dirname + '/public'));

// Logs every request's total handling time so slow requests are visible.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const tag = ms > SLOW_MS ? '[perf][slow]' : '[perf]';
    console.log(`${tag} ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// Simple in-memory cache so we don't re-fetch/re-parse the feed on every request
const cache = new Map(); // url -> { data, fetchedAt }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// webcal:// (and webcals://) are just aliases calendar apps use to mean
// "subscribe over http(s)" — they aren't a fetchable scheme on their own.
function normalizeIcalUrl(url) {
  if (/^webcals?:\/\//i.test(url)) return url.replace(/^webcals?:\/\//i, 'https://');
  return url;
}

async function getEvents(icalUrl) {
  icalUrl = normalizeIcalUrl(icalUrl);
  const cached = cache.get(icalUrl);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    console.log(`[perf] cache hit for ${icalUrl} (${cached.data.length} events)`);
    return cached.data;
  }

  const fetchStart = Date.now();
  const raw = await ical.async.fromURL(icalUrl);
  const fetchMs = Date.now() - fetchStart;
  const fetchTag = fetchMs > SLOW_MS ? '[perf][slow]' : '[perf]';
  console.log(`${fetchTag} ICS fetch+parse for ${icalUrl} (${fetchMs}ms)`);

  const expandStart = Date.now();
  const events = [];

  for (const key in raw) {
    const item = raw[key];
    if (item.type !== 'VEVENT') continue;

    if (item.rrule) {
      // Expand recurring events across a wide window (1 year back, 1 year forward)
      const windowStart = dayjs().subtract(1, 'year').toDate();
      const windowEnd = dayjs().add(1, 'year').toDate();
      const dates = item.rrule.between(windowStart, windowEnd, true);
      const duration = dayjs(item.end).diff(dayjs(item.start));

      for (const date of dates) {
        // Skip dates that were overridden/excluded (handled in node-ical's recurrences map)
        const dateKey = dayjs(date).format('YYYY-MM-DD');
        const override = item.recurrences && item.recurrences[dateKey];
        if (override) {
          events.push(toEvent(override));
        } else if (!(item.exdate && item.exdate[dateKey])) {
          events.push(
            toEvent({
              summary: item.summary,
              description: item.description,
              location: item.location,
              datetype: item.datetype,
              start: date,
              end: new Date(date.getTime() + duration),
            })
          );
        }
      }
    } else {
      events.push(toEvent(item));
    }
  }

  const expandMs = Date.now() - expandStart;
  const expandTag = expandMs > SLOW_MS ? '[perf][slow]' : '[perf]';
  console.log(`${expandTag} event expansion for ${icalUrl}: ${events.length} events (${expandMs}ms)`);

  cache.set(icalUrl, { data: events, fetchedAt: Date.now() });
  return events;
}

function toEvent(item) {
  const start = dayjs(item.start);
  // node-ical marks date-only (no time) VEVENTs on item.start.dateOnly / datetype
  const allDay = !!(item.start && item.start.dateOnly) || !item.start.getHours;
  // Per request: the DESCRIPTION field is treated as the event's location
  // (falls back to the actual LOCATION field if DESCRIPTION is empty).
  const location = (item.description && item.description.trim()) || item.location || '';
  return {
    summary: item.summary || '(No title)',
    location,
    start: item.start,
    end: item.end || item.start,
    allDay: item.datetype === 'date' || allDay,
  };
}

app.get('/', async (req, res) => {
  const icalUrl = normalizeIcalUrl((req.query.ical || DEFAULT_ICAL_URL || '').trim());
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  if (!icalUrl) {
    return res.send(
      renderPage({ needsUrl: true })
    );
  }

  const dateParam = req.query.date; // expected format YYYY-MM-DD
  const current = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    ? dayjs(dateParam)
    : todayEastern();

  const monthParam = req.query.month; // expected format YYYY-MM
  const displayMonth = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? dayjs(monthParam + '-01').startOf('month')
    : current.startOf('month');

  try {
    const events = await getEvents(icalUrl);
    const renderStart = Date.now();
    const html = renderPage({ events, current, displayMonth, icalUrl });
    console.log(`[perf] renderPage: ${events.length} events (${Date.now() - renderStart}ms)`);
    return res.send(html);
  } catch (err) {
    console.error('Failed to load/parse iCal feed:', err.message);
    return res.send(
      renderPage({ error: err.message, icalUrl })
    );
  }
});

app.listen(PORT, () => {
  console.log(`iCal calendar app running at http://localhost:${PORT}`);
  if (DEFAULT_ICAL_URL) {
    console.log(`Using default feed: ${DEFAULT_ICAL_URL}`);
  } else {
    console.log('No ICAL_URL set — pass one via ?ical=<feed-url> or set the ICAL_URL env var.');
  }
});

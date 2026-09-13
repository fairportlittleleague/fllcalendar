const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const advancedFormat = require('dayjs/plugin/advancedFormat');
const { version: APP_VERSION } = require('../package.json');
const { SOURCE_URL: FIELD_STATUS_SOURCE_URL } = require('../fieldStatus');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advancedFormat);

// Event times from the feed are treated as UTC and displayed in America/New_York time.
const EASTERN_TZ = 'America/New_York';
function toEastern(date) {
  return dayjs.utc(date).tz(EASTERN_TZ);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function layout(bodyHtml, autoRefresh, pageTitle) {
  const title = pageTitle || 'FLL Event Calendar';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${autoRefresh ? '<meta http-equiv="refresh" content="3600" />' : ''}
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/public/style.css" />
</head>
<body>
  <div class="wrap">
    <div class="site-header">
      <div class="site-logo"><img src="/public/75.png" alt="Logo" /></div>
      <h1 class="site-title">${escapeHtml(title)}</h1>
    </div>
    ${bodyHtml}
    <div class="app-version">v${APP_VERSION}</div>
  </div>
</body>
</html>`;
}

function urlForm(error) {
  return `
  <div class="setup-card">
    <h1>iCal Calendar Viewer</h1>
    ${error ? `<p class="error">Could not load feed: ${escapeHtml(error)}</p>` : ''}
    <p>No feed is configured. Set the <code>ICAL_URL</code> environment variable to a public iCal feed URL (.ics, <code>webcal://</code> links work too) and restart the app.</p>
  </div>`;
}

// Returns true if the event (possibly multi-day) touches the given day.
function eventTouchesDay(ev, day) {
  const evStart = toEastern(ev.start).startOf('day');
  const evEndRaw = toEastern(ev.end || ev.start);
  // All-day events store an exclusive end date in iCal, so pull it back a tick.
  const evEnd = ev.allDay && evEndRaw.isAfter(evStart) ? evEndRaw.subtract(1, 'second').startOf('day') : evEndRaw.startOf('day');
  return !day.isBefore(evStart, 'day') && !day.isAfter(evEnd, 'day');
}

function buildDayView(day, events) {
  const dayEvents = events
    .filter((ev) => eventTouchesDay(ev, day))
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return toEastern(a.start).diff(toEastern(b.start));
    });

  if (dayEvents.length === 0) {
    return `<p class="empty">No events on this day.</p>`;
  }

  // Group by location, sorted alphabetically (No location group goes last)
  const groups = new Map();
  for (const ev of dayEvents) {
    const key = ev.location || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }

  // Locations mentioning FLL are weighted heavier so they sort to the top of the day.
  function locationWeight(location) {
    return location && location.toUpperCase().includes('FLL') ? 200 : 0;
  }

  const sortedLocations = [...groups.keys()].sort((a, b) => {
    const weightDiff = locationWeight(b) - locationWeight(a);
    if (weightDiff !== 0) return weightDiff;
    if (!a !== !b) return a ? -1 : 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });

  const sections = [];
  for (const location of sortedLocations) {
    const evs = groups.get(location);
    const cards = evs.map((ev) => {
      const title = escapeHtml(ev.summary);
      const timeLabel = ev.allDay
        ? 'All day'
        : `${toEastern(ev.start).format('h:mm A')} – ${toEastern(ev.end).format('h:mm A')}`;
      return `<div class="event-card${ev.allDay ? ' all-day' : ''}">
        <div class="event-card-title">${title}</div>
        <div class="event-detail-row"><strong>Time:</strong> ${escapeHtml(timeLabel)}</div>
      </div>`;
    }).join('');

    const header = location
      ? `<div class="location-header">${escapeHtml(location).replace(/\n/g, '<br>')}</div>`
      : `<div class="location-header location-none">No location</div>`;

    sections.push(`<div class="location-group">${header}<div class="day-events-list">${cards}</div></div>`);
  }

  return sections.join('');
}

// Renders the current day plus the following 7 days (8 days total)
function buildRangeView(current, events) {
  const today = toEastern(new Date()).startOf('day');
  const days = [];
  for (let i = 0; i <= 7; i++) days.push(current.add(i, 'day'));

  return days.map((day) => {
    const isToday = today.isSame(day, 'day');
    return `<div class="day-section">
      <h2 class="day-heading${isToday ? ' is-today' : ''}">${day.format('dddd, MMMM D, YYYY')}</h2>
      ${buildDayView(day, events)}
    </div>`;
  }).join('');
}

function buildMonthCalendar(current, displayMonth, events) {
  const monthStart = displayMonth.startOf('month');
  const monthEnd = displayMonth.endOf('month');

  // Collect all days in this month that have at least one event
  const eventDays = new Set();
  events.forEach((ev) => {
    const evStart = toEastern(ev.start).startOf('day');
    const evEnd = toEastern(ev.end || ev.start).startOf('day');
    for (let d = evStart; !d.isAfter(monthEnd, 'day'); d = d.add(1, 'day')) {
      if (!d.isBefore(monthStart, 'day')) {
        eventDays.add(d.format('YYYY-MM-DD'));
      }
      if (d.isSame(evEnd, 'day')) break;
    }
  });

  const firstDayOfWeek = monthStart.day(); // 0 = Sun
  const daysInMonth = displayMonth.daysInMonth();
  const today = toEastern(new Date()).startOf('day');
  const curDateStr = current.format('YYYY-MM-DD');

  const prevMonth = displayMonth.subtract(1, 'month').format('YYYY-MM');
  const nextMonth = displayMonth.add(1, 'month').format('YYYY-MM');

  const headers = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
    .map((d) => `<th>${d}</th>`)
    .join('');

  let rows = '<tr>';
  let col = firstDayOfWeek;
  for (let i = 0; i < firstDayOfWeek; i++) rows += '<td></td>';

  for (let day = 1; day <= daysInMonth; day++) {
    if (col === 7) { rows += '</tr><tr>'; col = 0; }
    const date = displayMonth.date(day);
    const dateStr = date.format('YYYY-MM-DD');
    const isSelected = current.isSame(date, 'day');
    const isToday = today.isSame(date, 'day');
    const hasEvents = eventDays.has(dateStr);
    let cls = 'cal-day';
    if (isSelected) cls += ' selected';
    else if (isToday) cls += ' today';
    rows += `<td><a class="${cls}" href="/calendar?date=${dateStr}">${day}${hasEvents ? '<span class="event-dot"></span>' : ''}</a></td>`;
    col++;
  }
  while (col < 7) { rows += '<td></td>'; col++; }
  rows += '</tr>';

  return `<div class="month-cal">
    <div class="month-cal-header">
      <a class="month-nav" href="/calendar?date=${curDateStr}&month=${prevMonth}">&#8249;</a>
      <span class="month-label">${displayMonth.format('MMMM YYYY')}</span>
      <a class="month-nav" href="/calendar?date=${curDateStr}&month=${nextMonth}">&#8250;</a>
    </div>
    <table class="month-grid">
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderPage({ needsUrl, error, events, current, displayMonth }) {
  if (needsUrl || (error && !events)) {
    return layout(urlForm(error));
  }

  const rangeEnd = current.add(7, 'day');
  const prevDay = current.subtract(7, 'day').format('YYYY-MM-DD');
  const nextDay = current.add(7, 'day').format('YYYY-MM-DD');

  const rangeLabel = current.isSame(rangeEnd, 'month')
    ? `${current.format('MMMM D')} – ${rangeEnd.format('D, YYYY')}`
    : `${current.format('MMMM D')} – ${rangeEnd.format('MMMM D, YYYY')}`;

  const body = `
    <div class="page-layout">
      <div class="sidebar">
        ${buildMonthCalendar(current, displayMonth, events)}
      </div>
      <div class="main-content">
        <div class="toolbar">
          <h1>${rangeLabel}</h1>
          <div class="nav">
            <a class="btn" href="/calendar?date=${prevDay}">&larr; Prev</a>
            <a class="btn" href="/calendar?date=${toEastern(new Date()).format('YYYY-MM-DD')}">Today</a>
            <a class="btn" href="/calendar?date=${nextDay}">Next &rarr;</a>
            <a class="btn" href="/fields">Field Status</a>
          </div>
        </div>
        ${buildRangeView(current, events)}
      </div>
    </div>
  `;

  return layout(body, true);
}

function renderFieldStatusPage({ fields, lastUpdated, error }) {
  const body = `
    <div class="toolbar">
      <div class="nav">
        <a class="btn" href="/calendar">Calendar</a>
      </div>
    </div>
    ${error ? `<p class="error">Could not load field status: ${escapeHtml(error)}</p>` : `
      ${lastUpdated ? `<p class="source">${escapeHtml(lastUpdated)}</p>` : ''}
      <ul class="field-status-list">
        ${fields.map((f) => `
          <li class="field-status-item">
            <span class="field-status-icon ${f.open ? 'is-open' : 'is-closed'}">${f.open ? '&#10003;' : '&#10007;'}</span>
            <span class="field-status-name">${escapeHtml(f.name)}</span>
          </li>`).join('')}
      </ul>
    `}
    <p class="source">Source: <a href="${FIELD_STATUS_SOURCE_URL}" target="_blank">fairportlittleleague.org</a></p>
  `;

  return layout(body, true, 'FLL Field Status');
}

module.exports = { renderPage, renderFieldStatusPage };

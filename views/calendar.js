const dayjs = require('dayjs');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function layout(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FLL Event Calendar</title>
  <link rel="stylesheet" href="/public/style.css" />
</head>
<body>
  <div class="wrap">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function urlForm(icalUrl, error) {
  return `
  <div class="setup-card">
    <h1>iCal Calendar Viewer</h1>
    ${error ? `<p class="error">Could not load feed: ${escapeHtml(error)}</p>` : ''}
    <p>Enter a public iCal feed URL (.ics) to view it as a calendar. <code>webcal://</code> links work too.</p>
    <form method="GET" action="/">
      <input type="text" name="ical" placeholder="webcal://example.com/calendar.ics" value="${escapeHtml(icalUrl || '')}" required />
      <button type="submit">Load Calendar</button>
    </form>
    <p class="hint">Tip: set the <code>ICAL_URL</code> environment variable to skip this step.</p>
  </div>`;
}

// Returns true if the event (possibly multi-day) touches the given day.
function eventTouchesDay(ev, day) {
  const evStart = dayjs(ev.start).startOf('day');
  const evEndRaw = dayjs(ev.end || ev.start);
  // All-day events store an exclusive end date in iCal, so pull it back a tick.
  const evEnd = ev.allDay && evEndRaw.isAfter(evStart) ? evEndRaw.subtract(1, 'second').startOf('day') : evEndRaw.startOf('day');
  return !day.isBefore(evStart, 'day') && !day.isAfter(evEnd, 'day');
}

function buildDayView(current, events) {
  const dayEvents = events
    .filter((ev) => eventTouchesDay(ev, current))
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return dayjs(a.start).diff(dayjs(b.start));
    });

  if (dayEvents.length === 0) {
    return `<p class="empty">No events on this day.</p>`;
  }

  // Group by location, preserving insertion order (already time-sorted above)
  const groups = new Map();
  for (const ev of dayEvents) {
    const key = ev.location || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }

  const sections = [];
  for (const [location, evs] of groups) {
    const cards = evs.map((ev) => {
      const title = escapeHtml(ev.summary);
      const timeLabel = ev.allDay
        ? 'All day'
        : `${dayjs(ev.start).format('h:mm A')} – ${dayjs(ev.end).format('h:mm A')}`;
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

function buildMonthCalendar(current, displayMonth, events, icalUrl) {
  const icalParam = icalUrl ? `&ical=${encodeURIComponent(icalUrl)}` : '';
  const monthStart = displayMonth.startOf('month');
  const monthEnd = displayMonth.endOf('month');

  // Collect all days in this month that have at least one event
  const eventDays = new Set();
  events.forEach((ev) => {
    const evStart = dayjs(ev.start).startOf('day');
    const evEnd = dayjs(ev.end || ev.start).startOf('day');
    for (let d = evStart; !d.isAfter(monthEnd, 'day'); d = d.add(1, 'day')) {
      if (!d.isBefore(monthStart, 'day')) {
        eventDays.add(d.format('YYYY-MM-DD'));
      }
      if (d.isSame(evEnd, 'day')) break;
    }
  });

  const firstDayOfWeek = monthStart.day(); // 0 = Sun
  const daysInMonth = displayMonth.daysInMonth();
  const today = dayjs().startOf('day');
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
    rows += `<td><a class="${cls}" href="/?date=${dateStr}${icalParam}">${day}${hasEvents ? '<span class="event-dot"></span>' : ''}</a></td>`;
    col++;
  }
  while (col < 7) { rows += '<td></td>'; col++; }
  rows += '</tr>';

  return `<div class="month-cal">
    <div class="month-cal-header">
      <a class="month-nav" href="/?date=${curDateStr}&month=${prevMonth}${icalParam}">&#8249;</a>
      <span class="month-label">${displayMonth.format('MMMM YYYY')}</span>
      <a class="month-nav" href="/?date=${curDateStr}&month=${nextMonth}${icalParam}">&#8250;</a>
    </div>
    <table class="month-grid">
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderPage({ needsUrl, error, events, current, displayMonth, icalUrl }) {
  if (needsUrl || (error && !events)) {
    return layout(urlForm(icalUrl, error));
  }

  const prevDay = current.subtract(1, 'day').format('YYYY-MM-DD');
  const nextDay = current.add(1, 'day').format('YYYY-MM-DD');
  const icalParam = `&ical=${encodeURIComponent(icalUrl)}`;

  const body = `
    <div class="page-layout">
      <div class="sidebar">
        ${buildMonthCalendar(current, displayMonth, events, icalUrl)}
      </div>
      <div class="main-content">
        <div class="toolbar">
          <h1>${current.format('dddd, MMMM D, YYYY')}</h1>
          <div class="nav">
            <a class="btn" href="/?date=${prevDay}${icalParam}">&larr; Prev</a>
            <a class="btn" href="/?date=${dayjs().format('YYYY-MM-DD')}${icalParam}">Today</a>
            <a class="btn" href="/?date=${nextDay}${icalParam}">Next &rarr;</a>
          </div>
        </div>
        ${buildDayView(current, events)}
      </div>
    </div>
  `;

  return layout(body);
}

module.exports = { renderPage };

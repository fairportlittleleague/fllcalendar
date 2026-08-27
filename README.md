# iCal Calendar Viewer

A small Node.js/Express app that fetches a public iCal (`.ics`) feed and renders a
single day's events, in full detail, in the browser.

## Features

- Fetches and parses any public `.ics` feed URL (Google Calendar, Outlook, Apple Calendar,
  CalendarLabs, etc.), including `webcal://` links
- Expands recurring events (`RRULE`), including overridden/exception instances
- Shows one day at a time with Prev / Today / Next navigation (`/?date=YYYY-MM-DD`)
- All-day and multi-day events appear on every day they touch
- Every event's full detail is always visible — no truncation, no click-to-expand
- The `DESCRIPTION` field is shown as the event's **Location** (falling back to the
  actual `LOCATION` field if `DESCRIPTION` is empty) — useful for feeds that put venue
  or room info in the description instead of the location field
- 5-minute in-memory cache per feed URL so the feed isn't re-fetched on every click
- Zero build step — plain Express + server-rendered HTML + one CSS file

## Setup

```bash
npm install
```

## Run

Option 1 — pass the feed URL as a query param each time:

```bash
npm start
# then visit http://localhost:3000/?ical=https://example.com/calendar.ics
```

Option 2 — set a default feed via environment variable so you can just visit `/`:

export ICAL_URL='webcal://calendar.bluesombrero.com/api/v1/Calendar?instancekey=leagues&portalId=80619&id=47088120&key=EOL5XG9Y'

```bash
ICAL_URL="webcal://calendar.bluesombrero.com/api/v1/Calendar?instancekey=leagues&portalId=80619&id=47088120&key=EOL5XG9Y" npm start
```

Optionally set a custom port:

```bash
PORT=4000 npm start
```

Then open the printed URL in your browser. It opens on today by default; use
Prev / Today / Next to move between days, or pass `?date=YYYY-MM-DD` directly.

## Run with Docker

```bash
docker compose up --build
```

Set `ICAL_URL` in your shell (or a `.env` file) beforehand to use a default feed:

```bash
ICAL_URL="webcal://calendar.bluesombrero.com/api/v1/Calendar?instancekey=leagues&portalId=80619&id=47088120&key=EOL5XG9Y" docker compose up --build
```

Then visit http://localhost:3000. Or build/run the image directly:

```bash
docker build -t fll-calendar .
docker run --rm -p 3000:3000 -e ICAL_URL="..." fll-calendar
```

## Project structure

```
server.js          Express server, feed fetching/parsing, recurrence expansion, caching
views/calendar.js   Pure functions that build the day view HTML
public/style.css    Styling for the day view and setup form
```

## Notes

- If no `ical` query param or `ICAL_URL` env var is set, the app shows a small form to
  enter a feed URL.
- The feed cache is per-process and in-memory; restart the server (or wait 5 minutes) to
  force a re-fetch of a feed.
- For calendars requiring authentication, fetch a "private" or "secret" iCal link if your
  provider offers one (Google Calendar, for example, provides a "Secret address in iCal
  format" under calendar settings).

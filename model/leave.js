// Shared leave detection used by both the Jira (ticket) and Jobcan (default)
// strategies so they can never disagree about what counts as leave.
//
// Leave = an Out-of-Office event tagged with [PTO] or [SL] in the title.
// BOTH conditions are required. An untagged OOO event, or a tagged event that
// is not OOO, is not leave.
const moment = require('moment-timezone');

const YYYYMMDD = 'YYYY-MM-DD';
const FULL_DAY_HOURS = 8; // a timed leave >= 8h is a full day, otherwise a half day

const LEAVE_TYPES = ['PTO', 'SL'];

function extractLeaveType(value) {
  const regex = /[\[{]([a-zA-Z]+)[\]}]/;
  const match = regex.exec(value || '');
  if (match) {
    const tag = match[1].trim();
    if (LEAVE_TYPES.indexOf(tag) !== -1) return tag;
  }
  return null;
}

// Returns the leave type ('PTO' | 'SL') if the event qualifies as leave, else null.
function getLeaveType(event) {
  if (!event || event.eventType !== 'outOfOffice') return null;
  return extractLeaveType(event.summary) || extractLeaveType(event.description);
}

// Normalize a leave event into one entry per day it covers:
//   { day, full, window: { start, end } | null, type, ampm }
// - Timed event (>= 8h) or all-day event  -> full day.
// - Timed event (< 8h)                     -> half day window, AM if it starts
//                                             before noon, otherwise PM.
function normalizeLeaveEvent(event, type) {
  const start = event.start || {};
  const end = event.end || {};

  if (start.dateTime && end.dateTime) {
    const from = moment(start.dateTime);
    const to = moment(end.dateTime);
    const hours = (to - from) / 1000 / 60 / 60;
    const full = hours >= FULL_DAY_HOURS;
    const ampm = full ? null : parseInt(from.format('HH'), 10) < 12 ? 'AM' : 'PM';
    return [
      {
        day: from.format(YYYYMMDD),
        full,
        window: { start: from, end: to },
        type,
        ampm,
      },
    ];
  }

  // All-day event: dates only, end is exclusive. Always a full day, may span days.
  if (start.date && end.date) {
    const days = [];
    const current = moment(start.date);
    const stop = moment(end.date);
    while (current.isBefore(stop)) {
      days.push({ day: current.format(YYYYMMDD), full: true, window: null, type, ampm: null });
      current.add(1, 'day');
    }
    return days;
  }

  return [];
}

// Build a map keyed by YYYY-MM-DD:
//   { full: bool, windows: [{ start, end }], entries: [normalized...] }
function buildLeaveMap(events) {
  const map = {};
  for (const event of events || []) {
    const type = getLeaveType(event);
    if (!type) continue;
    for (const entry of normalizeLeaveEvent(event, type)) {
      if (!map[entry.day]) map[entry.day] = { full: false, windows: [], entries: [] };
      const day = map[entry.day];
      if (entry.full) day.full = true;
      if (entry.window) day.windows.push(entry.window);
      day.entries.push(entry);
    }
  }
  return map;
}

// Does [start, end) (moments) overlap leave on its day? Returns:
//   { full: true, type } | { full: false, window } | null
// Uses strict inequality so events that merely touch the boundary do not count.
function findLeaveOverlap(leaveMap, start, end) {
  if (!start || !end) return null;
  const info = leaveMap[moment(start).format(YYYYMMDD)];
  if (!info) return null;
  if (info.full) return { full: true, type: info.entries[0].type };
  for (const window of info.windows) {
    if (start.isBefore(window.end) && end.isAfter(window.start)) {
      return { full: false, window };
    }
  }
  return null;
}

module.exports = { buildLeaveMap, findLeaveOverlap, getLeaveType, FULL_DAY_HOURS };

// by @vadimburlakin
//
const moment = require('moment-timezone');
const { buildLeaveMap } = require('../leave.js');
const YYYYMMDD = 'YYYY-MM-DD';
const HHmm = 'HH:mm';

function getEventStartDate(event) {
  if (!event.start) {
    return null;
  }

  if (event.start.dateTime) {
    return moment(event.start.dateTime); // TODO add proper parsing
  }

  if (event.start.date) {
    // this is an all-day event
    return null;
  }

  throw new Error(
    'Unexpected start date pattern: ' + JSON.stringify(event.start)
  );
}

function getEventEndDate(event) {
  if (!event.end) {
    return null;
  }

  if (event.end.dateTime) {
    return moment(event.end.dateTime); // TODO add proper parsing
  }

  if (event.end.date) {
    // this is an all day event
    return null;
  }

  throw new Error('Unexpected end date pattern: ' + JSON.stringify(event.end));
}

function getEventDays(event) {
  const days = [];
  const current = getEventStartDate(event);
  const end = getEventEndDate(event);

  if (!(current && end)) {
    return [];
  }

  while (true) {
    days.push(current.format(YYYYMMDD));

    const duration = (end - current) / 1000 / 60 / 60;
    if (current.format(YYYYMMDD) === end.format(YYYYMMDD) || duration === 24) {
      break;
    }

    current.add(1, 'day');
  }

  return days;
}

function getBreakHoursForDay(startOfDay, endOfDay) {
  let breakTime = 0;
  const dailyHours = ((endOfDay - startOfDay) / 1000 / 60 / 60) - 1;

  // JobCan's default breaktime logic
  if (dailyHours >= 6 && dailyHours < 7)
    breakTime = 45;
  else if (dailyHours >= 7)
    breakTime = 60

  return breakTime;
}

// Does a work event overlap any of the day's leave windows? Strict inequality so
// events that merely touch the boundary still count as work.
function overlapsWindow(event, windows) {
  return windows.some(
    (w) => event.start.isBefore(w.end) && event.end.isAfter(w.start)
  );
}

function vacationOnlyEntry(dayKey, vacation, duration) {
  const date = moment(dayKey);
  return {
    earliestEvent: null,
    lastEvent: null,
    clockin: '--:--',
    clockout: '--:--',
    vacation,
    year: date.format('YYYY'),
    month: date.format('MM'),
    day: date.format('DD'),
    duration,
    breaktime: '--:--',
  };
}

function workEntry(earliest, last, vacation, vacationTime) {
  const breaktime = getBreakHoursForDay(earliest.start, last.end);
  return {
    earliestEvent: earliest,
    lastEvent: last,
    clockin: earliest.start.format(HHmm),
    clockout: last.end.format(HHmm),
    vacation,
    year: earliest.start.format('YYYY'),
    month: earliest.start.format('MM'),
    day: earliest.start.format('DD'),
    duration: ((last.end - earliest.start) / 1000 / 60) + vacationTime - breaktime,
    breaktime: moment(`2000-01-01 00:00`).minutes(breaktime).format('HH:mm'),
  };
}

function getWorkingHoursForDay(dayKey, dayEvents, leave) {
  const leaveType = leave && leave.entries.length ? leave.entries[0].type : null;

  // Full-day leave -> vacation only, no clock-in.
  if (leave && leave.full) {
    return vacationOnlyEntry(dayKey, leaveType, 8 * 60);
  }

  // Half-day leave -> clock in/out from the events that fall OUTSIDE the leave
  // window; the leave fills the rest of the day.
  if (leave && leave.windows.length) {
    const half = leave.entries.find((e) => e.ampm);
    const vacation = `${leaveType}-${half ? half.ampm : 'AM'}`;
    const vacationTime = leave.windows.reduce(
      (sum, w) => sum + (w.end - w.start) / 1000 / 60,
      0
    );

    const workEvents = dayEvents.filter(
      (e) => !e.outOfOffice && !overlapsWindow(e, leave.windows)
    );

    if (workEvents.length) {
      const earliest = workEvents.slice().sort((a, b) => a.start - b.start)[0];
      const last = workEvents.slice().sort((a, b) => b.end - a.end)[0];
      return workEntry(earliest, last, vacation, vacationTime);
    }

    // No work outside the leave window -> vacation only for the half day.
    return vacationOnlyEntry(dayKey, vacation, vacationTime);
  }

  // No leave -> original behaviour: needs more than one event to book a day.
  const workEvents = dayEvents.filter((e) => !e.outOfOffice);
  if (workEvents.length > 1) {
    const earliest = workEvents.slice().sort((a, b) => a.start - b.start)[0];
    const last = workEvents.slice().sort((a, b) => b.end - a.end)[0];
    return workEntry(earliest, last, '', 0);
  }

  return null;
}

module.exports = function (events) {
  // Detect leave from the raw events. All-day leave events never survive the
  // filters below (they have no dateTime), so the leave map is the only source.
  const leaveMap = buildLeaveMap(events);

  // pre-process
  let hash = events
    .map((event) => ({
      title: event.summary,
      outOfOffice: event.eventType === 'outOfOffice',
      colorId: event.colorId,
      start: getEventStartDate(event),
      end: getEventEndDate(event),
      days: getEventDays(event),
      attended: event.attendees
        ? event.status === 'confirmed' && event.attendees.find((attendee) => attendee.self).responseStatus ===
          'accepted'
        : event.status === 'confirmed',
    }))
    .filter((event) => event.attended)
    .filter((event) => event.start) // only consider events that are not all-day events
    .reduce((rv, current) => {
      for (let day of current.days) {
        if (!rv[day]) {
          rv[day] = [];
        }
        rv[day].push(current);
      }
      return rv;
    }, {});

  // Make sure days that only carry leave (e.g. an all-day PTO with no meetings)
  // are represented even though they had no timed events.
  for (const day of Object.keys(leaveMap)) {
    if (!hash[day]) hash[day] = [];
  }

  // post-process
  for (const [key, value] of Object.entries(hash)) {
    const workingHours = getWorkingHoursForDay(key, value, leaveMap[key]);
    if (workingHours)
      hash[key] = workingHours;
    else
      delete hash[key];
  }

  return hash;
};

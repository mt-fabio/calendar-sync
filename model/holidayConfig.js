// Company-specific Jobcan leave types, keyed by the tag used in calendar event
// titles ([PTO], [SL], ...) with an optional -AM / -PM suffix for half days.
// Edit holidays.json to match your company:
//
//   code: value of the option in Jobcan's holiday-type dropdown
//         (select.holiday_id on https://ssl.jobcan.jp/employee/holiday/new)
//   text: label shown when logging, and matched in the "already requested" check
const holidayMap = require('../holidays.json');

// Base tags recognized in calendar titles (suffixes stripped): e.g. PTO, SL.
const leaveTypes = [...new Set(Object.keys(holidayMap).map((k) => k.split('-')[0]))];

module.exports = { holidayMap, leaveTypes };

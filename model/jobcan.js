const colors = require('colors/safe');
const moment = require('moment-timezone');
const holidays = new (require('date-holidays'))();
const puppeteer = require('puppeteer');
const { holidayMap } = require('./holidayConfig');

/*
 events = {
  duration: 8*60
  clockin: '10:00'
  clockout: '19:00'
  breaktime: '1:00'
  year: '2020'
  month: '01'
  day: '01'
 }
 */
class Jobcan {
  constructor() {
    holidays.init(process.env.HOLIDAY_ZONE || 'JP');
    this.LINE_BREAK =
      '----------------------------------------------------------------------------------------------------';
    this.holiday_map = holidayMap;
  }

  // best effort!
  isHoliday(date) {
    return (
      ['Sat', 'Sun'].indexOf(date.format('ddd')) !== -1 ||
      holidays.isHoliday(date.toDate())
    );
  }

  display(events, overlapDays = new Set()) {
    let dduration = 0;
    let overtime = 0;
    let weekday = 0;
    const FULL_DAY = 480;

    console.log(colors.bold(`\nJOBCAN`));
    console.log(this.LINE_BREAK);
    for (const [key, value] of Object.entries(events)) {
      let duration = moment(`2000-01-01 00:00`).minutes(value.duration);
      if (duration.hours() > 9) {
        duration = colors.red(duration.format('HH:mm'));
      } else if (duration.hours() < 7) {
        duration = colors.yellow(duration.format('HH:mm'));
      } else {
        duration = colors.green(duration.format('HH:mm'));
      }

      const onHoliday = this.isHoliday(moment(key));
      const markers = [];
      if (this.holiday_map[value.vacation] && onHoliday)
        markers.push('⚠ Weekend/Holiday (not registered)');
      if (overlapDays.has(key)) markers.push('⚠');

      const parts = [
        colors.blue(moment(key).format('ddd')),
        moment(key).format('MM-DD'),
        colors.grey(value.clockin),
        colors.grey(value.clockout),
        colors.grey(value.breaktime),
        duration,
        colors.yellow(value.vacation),
      ];
      if (markers.length) parts.push(colors.yellow(markers.join('  ')));
      const line = parts.join('  ');

      if (onHoliday) {
        console.log(colors.grey(line));
      } else {
        console.log(line);
        weekday += 1;
      }
      dduration += value.duration;
      overtime += value.duration - FULL_DAY;
    }

    dduration = moment(`2000-01-01 00:00`).add(dduration / weekday, 'minutes');

    let isOvertime = false;
    if (overtime > 0) {
      isOvertime = true;
    }
    const overtimeText =
      (isOvertime ? '+' : '-') +
      moment(`2000-01-01 00:00`)
        .add(Math.abs(overtime), 'minutes')
        .format('HH:mm');

    console.log(this.LINE_BREAK);
    console.log(
      colors.bold(
        `>Average: ${dduration.format(
          'HH:mm'
        )} ⏱  during ${weekday} weekdays. ${
          isOvertime ? colors.green(overtimeText) : colors.red(overtimeText)
        }`
      )
    );
  }

  async clear(page, selector) {
    await page.$eval(selector, (el) => (el.value = ''));
  }

  async exists(page, xpath) {
    const elements = await page.evaluate((xpath) => {
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return result.snapshotLength;
    }, xpath);
    return elements > 0;
  }

  async hasRequested(page, date, vacation) {
    await Promise.all([
      page.goto(
        `https://ssl.jobcan.jp/employee/holiday/?search_type=month&month=${date[1]}&year=${date[0]}`
      ),
      page.waitForNavigation(),
    ]);

    const requestedXpath = `//tr[td[contains(text(),"${vacation}")] and td[contains(text(),"${date[1]}/${date[2]}/${date[0]}")]]`;
    const elements = await page.$x(requestedXpath);
    return elements.length > 0;
  }

  async requestVacation(page, date, vacation) {
    let holiday_date = date.split('-');
    if (
      await this.hasRequested(page, holiday_date, this.holiday_map[vacation])
    ) {
      console.log(colors.grey(`${date} ${this.holiday_map[vacation].text}`)); // already requested
    } else {
      await page.goto(`https://ssl.jobcan.jp/employee/holiday/new`);
      await page.waitForSelector('select.holiday_id', { visible: true });
      await page.select('select.holiday_id', this.holiday_map[vacation].code);

      // Jobcan's date <select> option values are NOT zero-padded (e.g. '7', not
      // '07'), so strip leading zeros before selecting or the value silently
      // fails to match and the field keeps its default (the 1st).
      const month = String(parseInt(holiday_date[1], 10));
      const day = String(parseInt(holiday_date[2], 10));
      const year = String(parseInt(holiday_date[0], 10));

      await page.select('#holiday_month', month);
      await page.select('#to_holiday_month', month);
      await page.select('#holiday_day', day);
      await page.select('#to_holiday_day', day);
      await page.select('#holiday_year', year);
      await page.select('#to_holiday_year', year);

      // Submit form and wait for navigation to a new page
      const submit = await page.$x(
        '//div//input[@type="submit" and @class="btn jbc-btn-primary"]'
      );
      await Promise.all([submit[0].click(), page.waitForNavigation()]);

      const submit2 = await page.$x(
        '//div//input[@type="button" and @class="btn jbc-btn-secondary"]'
      );
      await Promise.all([submit2[0].click(), page.waitForNavigation()]);

      console.log(colors.blue(`${date} ${this.holiday_map[vacation].text}`));
    }
  }

  async persist(events) {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    try {
      await page.goto('https://id.jobcan.jp/users/sign_in?app_key=atd&lang=ja');
      await page.setViewport({ width: 1080, height: 720 });

      await page.type('#user_email', process.env.JOBCAN_USERNAME);
      await page.type('#user_password', process.env.JOBCAN_PASSWORD);
      await page.click('#login_button');

      // Wait for navigation after login
      await page.waitForSelector('#working_status', { visible: true });
      
      for (const [key, value] of Object.entries(events)) {
        await page.goto(
          `https://ssl.jobcan.jp/employee/adit/modify?year=${value.year}&month=${value.month}&day=${value.day}`
        );

        // Wait for the #ter_time element to appear
        await page.waitForSelector('#ter_time', { visible: true });
        
        // Add a delay after navigation
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (
          !(await this.exists(
            page,
            '//tr[@class="text-center"]//td[contains(., "Clock-in") or contains(., "Clock In")]'
          ))
        ) {
          if (
            !(await this.exists(
              page,
              '//form[@id="modifyForm"]//div[contains(., "Cannot revise clock time on this day")]'
            )) &&
            value.clockin !== '--:--' &&
            value.clockout !== '--:--'
          ) {
            console.log(
              colors.blue(`${key} ${value.clockin} ~ ${value.clockout}`)
            );

            // Clock-In
            await this.clear(page, '#ter_time');
            await page.type('#ter_time', value.clockin.replace(':', ''));
            await page.evaluate(() =>
              document.querySelector('#insert_button').click()
            );

            // Add a delay between actions
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Clock-Out
            await this.clear(page, '#ter_time');
            await page.type('#ter_time', value.clockout.replace(':', ''));
            await page.evaluate(() =>
              document.querySelector('#insert_button').click()
            );

            // Add a delay before moving to the next entry
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          if (this.holiday_map[value.vacation]) {
            if (this.isHoliday(moment(key))) {
              // Never book leave on a weekend/holiday — it would waste a day.
              console.log(
                colors.yellow(`⚠ ${key} — skipping leave registration (weekend/holiday)`)
              );
            } else {
              await this.requestVacation(page, key, value.vacation);
            }
          }
        } else {
          console.log(
            colors.grey(`${key} ${value.clockin} ~ ${value.clockout}`)
          );
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      await browser.close();
    }
  }
}

module.exports = Jobcan;
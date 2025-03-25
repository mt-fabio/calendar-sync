const fetch = require('node-fetch');
const moment = require('moment');
const colors = require('colors/safe');
const fs = require('fs').promises;
const JapaneseHolidays = require('japanese-holidays');

//jira will return this message if the token is invalid
const INVALID_CREDS_MSG = 'Issue does not exist or you do not have permission to see it.';

// Jira API Documentation
// https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-worklogs/#api-rest-api-3-issue-issueidorkey-worklog-post
// Get API Key
// https://id.atlassian.com/manage-profile/security/api-tokens
class Jira {
  constructor() {
    this.CREDENTIAL_PATH = 'jira.json';
    this.EVENTS_PATH = 'events.json';
    this.LINE_BREAK = '----------------------------------------------------------------------------------------------------';
  }

  logEvent(event) {
    event.ids.forEach((id) => {
      const isHoliday = (date) => {
        return (
          ['Sat', 'Sun'].indexOf(date.format('ddd')) !== -1 ||
          JapaneseHolidays.isHoliday(date.toDate())
        );
      }

      const eventDuration = moment.duration(event.duration / event.ids.length, 'minutes');
      const line = [
        colors.blue(moment(event.start).format('MM-DD')),
        colors.yellow(id),
        `${eventDuration.asHours().toFixed(2)}`,
        colors.grey(event.description),
      ].join("  ");

      if (isHoliday(moment(event.start))) {
        console.log(colors.red(line));
      } else {
        console.log(line);
      }
    });
    return event;
  }

  display(events) {
    console.log(
      colors.bold(`\nJIRA`)
    );
    console.log(this.LINE_BREAK);
    const totalDurationMinutes = events
    .map(this.logEvent)
    .reduce((acc, e) => acc += e.duration, 0);
    console.log(this.LINE_BREAK);
    const totalDuration = moment.duration(totalDurationMinutes, 'minutes').asMinutes();
    console.log(
      colors.bold(
        `>Total: ${colors.yellow(`${Math.floor(totalDuration/60)}:${totalDuration % 60}`)} ⏱`
      )
    );
  }

  async getSavedEvents() {
    let bPersistedEvents;
    try {
      bPersistedEvents = await fs.readFile(this.EVENTS_PATH);
    } catch (error) {}

    return bPersistedEvents
      ? await JSON.parse(bPersistedEvents.toString('utf8'))
      : {};
  }

  async saveEvents(events) {
    await fs.writeFile(this.EVENTS_PATH, JSON.stringify(events));
  }

  getBody(jiraEvent) {
    let bodyString = `{
      "started": "${jiraEvent.startAt}",
      "timeSpentSeconds": ${jiraEvent.timeSpentSeconds},
      "comment": {
        "type": "doc",
        "version": 1,
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "text": "${jiraEvent.description}",
                "type": "text"
              }
            ]
          }
        ]
      }
    }`;
    return bodyString;
  }

  
  checkResponse(responseJson) {

    //Check for errors in the response
    if (responseJson?.errorMessages !== undefined && responseJson?.errorMessages.length > 0) {

      //We know the response we get for bad credentials, so we can check for that specifically
      console.log(colors.red(responseJson.errorMessages.some(m => m === INVALID_CREDS_MSG)
      ? 'Invalid JIRA credentials, please check your jira.json'
      : 'Failed to add worklog to jira: ' + responseJson.errorMessages));

      //Throw an error to stop the job early
      throw new Error('Failed to add worklog to jira. Exiting Job');
    }
  }

  async updateWorklog(jiraWorklogId, jiraEvent) {
    let credential;
    try {
      const bToken = await fs.readFile(this.CREDENTIAL_PATH);
      credential = JSON.parse(bToken.toString('utf8'));
    } catch (error) {
      console.log(error);      
      return;
    }
    const jiraRequestUrl = `${credential.domainUrl}/rest/api/3/issue/${jiraEvent.id}/worklog/${jiraWorklogId}`;
    const jiraRequestPayload = {
      method: "PUT",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${credential.email}:${credential.token}`
        ).toString('base64')}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: this.getBody(jiraEvent),
    };

    const response = await fetch(jiraRequestUrl, jiraRequestPayload);
    const responseJson = await response.json();

    this.checkResponse(responseJson);

    jiraEvent.jiraWorklogId = jiraWorklogId;
    return jiraEvent;
  }

  async addWorklog(jiraEvent) {
    let credential;
    try {
      const bToken = await fs.readFile(this.CREDENTIAL_PATH);
      credential = JSON.parse(bToken.toString('utf8'));
    } catch (error) {
      console.log(error);
      return;
    }

    const jiraRequestUrl = `${credential.domainUrl}/rest/api/3/issue/${jiraEvent.id}/worklog`;
    const jiraRequestPayload = {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${credential.email}:${credential.token}`
        ).toString('base64')}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: this.getBody(jiraEvent),
    };

    const response = await fetch(jiraRequestUrl, jiraRequestPayload);
    const responseJson = await response.json();
    
    this.checkResponse(responseJson);

    jiraEvent.jiraWorklogId = responseJson.id;
    return jiraEvent;
  }

  async persist(googleEvents) {
    let formattedEvents = googleEvents.map((event) => {
      const formattedEvent = {
        calendarId: event.calendarId,
        worklogs: []
      };

      event.ids.forEach((id) => {
        formattedEvent.worklogs.push({
          id: id,
          description: event.description,
          startAt: moment.utc(event.start).toISOString().replace('Z', '+0000'),
          timeSpentSeconds: (event.duration / event.ids.length) * 60,
        })
      });

      return formattedEvent;
    });

    const savedEvents = await this.getSavedEvents();
    for (let event of formattedEvents) {
      const calendarId = event.calendarId;
      let savedEvent = savedEvents[calendarId];

      if (savedEvent) {
        for (let worklog of event.worklogs) {
          let found = false;
          for (let savedWorklog of savedEvent.worklogs) {
            if (savedWorklog.id === worklog.id) {
              found = true;
              const shouldUpdate = (
                worklog.description != savedWorklog.description || worklog.timeSpentSeconds != savedWorklog.timeSpentSeconds
              );
              if (shouldUpdate) {
                console.log(colors.green(`${worklog.id}: ${worklog.description}`));
                // returns jiraEvent with the new worklog ID
                worklog = await this.updateWorklog(savedWorklog.jiraWorklogId, worklog);
              } else {
                console.log(colors.grey(`${worklog.id}: ${worklog.description}`));
              }

              break;
            }
          }

          if (!found) { // add new
            console.log(colors.blue(`${worklog.id}: ${worklog.description}`));
            worklog = await this.addWorklog(worklog); // returns jiraEvent with the new worklog ID
          }
        }

      } else {
        for (let worklog of event.worklogs) {
          console.log(colors.blue(`${worklog.id}: ${worklog.description}`));
          worklog = await this.addWorklog(worklog); // returns jiraEvent with the new worklog ID
        }
      }

      savedEvents[calendarId] = event;
    }

    await this.saveEvents(savedEvents);
  }
}

module.exports = Jira;

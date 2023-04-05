require('dotenv').config();

const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const { askIfContinue } = require('./lib/ask.js');
const jobcan = new (require('./model/jobcan.js'))();
const jira = new (require('./model/jira.js'))();
const colors = require('colors/safe');
const moment = require('moment-timezone');

function getDateRange(startDate, endDate) {
  let timeMin = startDate ? moment(startDate).toISOString() : moment().subtract(1, 'day').startOf('day').toISOString();
  let timeMax = endDate ? moment(endDate).toISOString() : moment().subtract(1, 'day').endOf('day').toISOString();

  return { timeMin, timeMax };
}

async function main(startDate, endDate) {
  const output = process.env.OUTPUT.toUpperCase();
  const { timeMin, timeMax } = getDateRange(startDate, endDate);

  console.log(colors.bold(`\n🤖 Locale ${moment.locale()}, timezone ${moment().format('Z')}`));
  console.log(colors.bold(`Search between ${colors.blue(timeMin)} and ${colors.blue(timeMax)}`));

  // TODO: support CSV
  const input = new (require(`./model/${process.env.INPUT}.js`))();
  const inputEvents = await input.getEventList(timeMin, timeMax);

  const jiraEvents = await require(`./input/${process.env.INPUT}.js`)(process.env.JIRA_STRATEGY, inputEvents);
  const jobcanEvents = await require(`./input/${process.env.INPUT}.js`)(process.env.JOBCAN_STRATEGY, inputEvents);

  if (output === 'JOBCAN') {
    jobcan.display(jobcanEvents);
  } else if (output === 'JIRA') {
    jira.display(jiraEvents);
  } else if (output === 'BOTH') {
    jira.display(jiraEvents);
    jobcan.display(jobcanEvents);
  }

  const question = `Do you want to persist the information into ${output === 'BOTH' ? 'JIRA and JOBCAN' : output}? (y/N) `;
  const accepted = ['y', 'Y', 'yes'];
  const shouldPersist = await askIfContinue(question, accepted);
  if (!shouldPersist) return;

  switch (output) {
    case 'JOBCAN':
      await jobcan.persist(jobcanEvents);
      break;
    case 'JIRA':
      await jira.persist(jiraEvents);
      break;
    case 'BOTH':
      await jira.persist(jiraEvents);
      await jobcan.persist(jobcanEvents);
    default:
      console.log('\n');
  }
}

async function listUserFolders(bucket, prefix) {
  try {
    const response = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: '/',
      })
      .promise();

    return response.CommonPrefixes.map(({ Prefix }) => Prefix);
  } catch (error) {
    console.error('Error listing user folders:', error);
    throw error;
  }
}

async function getFileFromS3(bucket, key) {
  try {
    const response = await s3
      .getObject({
        Bucket: bucket,
        Key: key,
      })
      .promise();

    return JSON.parse(response.Body.toString('utf-8'));
  } catch (error) {
    console.error(`Error getting file ${key} from S3:`, error);
    throw error;
  }
}

exports.handler = async (event) => {
  const bucket = 'calendar-sync-bucket';
  const userFoldersPrefix = 'CalendarSyncUsers/';

  try {
    // List user folders in the S3 bucket
    const userFolders = await listUserFolders(bucket, userFoldersPrefix);

    // Process each user folder
    for (const userFolder of userFolders) {
      // Retrieve start and end dates, credentials, and environment variables from S3
      const startDate = event.startDate;
      const endDate = event.endDate;
      const credentials = await getFileFromS3(bucket, `${userFolder}credentials.json`);
      const jiraCredentials = await getFileFromS3(bucket, `${userFolder}jira.json`);
      const token = await getFileFromS3(bucket, `${userFolder}token.json`);

      // Call the main function with the user's data
      await main(startDate, endDate, userFolder, credentials, jiraCredentials, token);
    }
  } catch (error) {
    console.error(error);
  }
};

const S3 = require('./s3');
const s3 = new S3('calendar-sync-bucket');

const { askIfContinue } = require('./lib/ask.js');
const colors = require('colors/safe');
const moment = require('moment-timezone');

function getDateRange() {
  let unit = 'week';
  let timeMin = moment().tz("Asia/Tokyo").subtract(1, unit).startOf(unit).toISOString();
  let timeMax = moment().tz("Asia/Tokyo").subtract(1, unit).endOf(unit).toISOString();

  let myArgs = process.argv.slice(2);
  if (myArgs[0]) timeMin = moment(myArgs[0]).tz("Asia/Tokyo").toISOString();
  if (myArgs[1]) timeMax = moment(myArgs[1]).tz("Asia/Tokyo").toISOString();

  return { timeMin, timeMax };
}

async function main(userFolderName) {
  const envFileContent = await s3.downloadFile(userFolderName, '.env');

  // Load environment variables from the .env file content
  const env = require('dotenv').parse(envFileContent);

  const output = env.OUTPUT.toUpperCase();
  const { timeMin, timeMax } = getDateRange();

  console.log(colors.bold(`\n🤖 Locale ${moment.locale()}, timezone ${moment().format('Z')}`));
  console.log(colors.bold(`Search between ${colors.blue(timeMin)} and ${colors.blue(timeMax)}`));

  // Instantiate JobCan and Jira classes within the main function and pass them s3 & foldername
  const jobcan = new (require('./model/jobcan.js'))(s3, userFolderName);
  const jira = new (require('./model/jira.js'))(s3, userFolderName);
  const input = new (require(`./model/${env.INPUT}.js`))(s3, userFolderName, env);

  const inputEvents = await input.getEventList(timeMin, timeMax);

  const jiraEvents = await require(`./input/${env.INPUT}.js`)(env.JIRA_STRATEGY, inputEvents);
  const jobcanEvents = await require(`./input/${env.INPUT}.js`)(env.JOBCAN_STRATEGY, inputEvents);

  if (output === 'JOBCAN') {
    jobcan.display(jobcanEvents);
  } else if (output === 'JIRA') {
    jira.display(jiraEvents);
  } else if (output === 'BOTH') {
    jira.display(jiraEvents);
    jobcan.display(jobcanEvents);
  }

  // const question = `Do you want to persist the information into ${output === 'BOTH' ? 'JIRA and JOBCAN' : output}? (y/N) `;
  // const accepted = ['y', 'Y', 'yes'];
  // const shouldPersist = await askIfContinue(question, accepted);
  // if (!shouldPersist) return;

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

exports.handler = async (event, context) => {
  try {
    const userFolderName = 'brandon_lamb'; // You can pass this value from the Lambda event
    await main(userFolderName);
    return {
      statusCode: 200,
      body: 'Success',
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: 'Error',
    };
  }
};

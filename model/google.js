// Code adapted from https://developers.google.com/calendar/quickstart/nodejs

const { askFor } = require('../lib/ask.js');
const { google } = require('googleapis');

class Google {
  constructor(s3, userFolderName) {
    this.s3 = s3;
    this.userFolderName = userFolderName;
    this.TOKEN_PATH = 'token.json';
    this.CREDENTIALS_PATH = 'credentials.json';
    this.SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
    this.OFFLINE = 'offline';
  }

  async authorize() {
    const credentialsFileContent = await this.s3.downloadFile(this.userFolderName, 'credentials.json');
    const credentials = JSON.parse(credentialsFileContent);

    const { client_secret, client_id, redirect_uris } = credentials.installed;

    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    const tokenFileContent = await this.s3.downloadFile(this.userFolderName, 'token.json');
    const token = JSON.parse(tokenFileContent);

    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  }
}

module.exports = Google;

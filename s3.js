const AWS = require('aws-sdk');

class S3 {
  constructor(bucketName) {
    this.s3 = new AWS.S3();
    this.bucketName = bucketName;
  }

  async uploadFile(folderName, fileName, content) {
    const key = `users/${folderName}/${fileName}`;
    const params = {
      Bucket: this.bucketName,
      Key: key,
      Body: content,
    };
  
    try {
      await this.s3.upload(params).promise();
      console.log(`File uploaded successfully: ${key}`);
    } catch (error) {
      console.error(`Error uploading ${fileName} file to S3: ${error}`);
      throw error;
    }
  }

  async downloadFile(folderName, fileName) {
    const key = `users/${folderName}/${fileName}`;
    const params = {
      Bucket: this.bucketName,
      Key: key,
    };

    try {
      const data = await this.s3.getObject(params).promise();
      return data.Body.toString('utf-8');
    } catch (error) {
      console.error(`Error downloading ${fileName} file from S3: ${error}`);
      throw error;
    }
  }
}

module.exports = S3;

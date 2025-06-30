import {CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import * as path from 'path'

const codebuild = new CodeBuildClient();

export const handler = async (event) => {
    console.log("EVENT: ", JSON.stringify(event));
    var filePath = event.Records[0].s3.object.key
    var filename = filePath.replace("uploads/", "")
    var scanID = path.basename(filename, '.zip')
    console.log("file path: ", filePath)
    console.log("file name: ", filename)
    console.log("scanId: ", scanID)

    try {

        const command = new StartBuildCommand({
            projectName: "CVEScanner",
            environmentVariablesOverride: [
                {
                    name: "S3_BUCKET",
                    value: "cve-scanner123012f30",
                    type: "PLAINTEXT"
                },
                {
                    name: "ZIP_NAME",
                    value: filename,
                    type: "PLAINTEXT"
                },
                {
                    name: 'SCAN_ID',
                    value: scanID,
                    type: "PLAINTEXT"
                },
                 {
                    name: "ZIP_PATH",
                    value: filePath,
                    type: "PLAINTEXT"
                },
            ]
            
        })
        const codebuildResponse = await codebuild.send(command);
        console.log("Build started...: ", codebuildResponse)
    } catch (error) {
        console.log("Error: ", error)
    }
};

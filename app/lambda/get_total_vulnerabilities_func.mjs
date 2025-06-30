import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.REGION });
const bucket = process.env.BUCKET_NAME

export const handler = async (event) => {
  try {
    const prefix = "summary_reports/"; 
    const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix
    })
    const listResponse = await s3.send(listCommand)
    console.log("list Response: ", JSON.stringify(listResponse))
    const listOfSummaryFiles =[]
    if (listResponse.Contents){
        for (const obj of listResponse.Contents) {
            if (obj.Key) {
                listOfSummaryFiles.push(obj.Key)
            }
        }
    }

    console.log("list summaries: ", listOfSummaryFiles)

    if (listOfSummaryFiles.length === 0) {
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "No summary files found" }),
        };
    }

    let totalSummarySeverities = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      UNKNOWN: 0,
    };

    for (const fileKey of listOfSummaryFiles) {
      try{
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: fileKey
        });
        const response = await s3.send(command);

        console.log("getting files response: ", response)
        const bytes = await response.Body.transformToByteArray();
        const byteA = Buffer.from(bytes)
        const jsonString = byteA.toString("utf-8")
        const summaryData = JSON.parse(jsonString);

        for (const entry of summaryData) {
          const severities = entry.numberOfSeverities || {};
          for (const [severity, count] of Object.entries(severities)) {
            if (totalSummarySeverities[severity] === undefined) {
              totalSummarySeverities[severity] = 0;
            }
            totalSummarySeverities[severity] += count;
          }
        }

        console.log(totalSummarySeverities)
      } catch(err) {
        console.error(`Error with ${fileKey}`, err)
      }
    }
       

    return {
      statusCode: 200,
      body: JSON.stringify({total: totalSummarySeverities}),
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
    };
  } catch (error) {
    console.error("Error getting all summaries:", JSON.stringify(error));
    return {
      statusCode: 500,
       headers: { 
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};
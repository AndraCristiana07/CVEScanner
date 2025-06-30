import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {S3Client, GetObjectCommand, HeadObjectCommand} from '@aws-sdk/client-s3';

const s3 = new S3Client()
const bucket = process.env.BUCKET_NAME

export const handler = async (event) => {
    try {
        const scanId = event.headers?.["scan-id"]
        const key = `summary_reports/trivy_summary_report_${scanId}.json`

        const checkIfExistsCommand = new HeadObjectCommand({
            Bucket: bucket,
            Key: key
        })

        try {
            await s3.send(checkIfExistsCommand)
        } catch (err){
            if (err.code === "NotFound"){
                return {
                    statusCode: 404,
                    body: "File not found in bucket"
                }
            }
        }

        if(!scanId) {
            return {
                statusCode: 400,
                body: "Missing scanId"
            }
        }
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: 'application/json'

        })
        console.log(`Get file ${key} from S3 bucket ${bucket}...`)
        const presignedUrl = await getSignedUrl(s3, command, {expiresIn: 360})

       return {
        statusCode: 200,
        headers: {
            "Content-Type": 'application/json',
        },
        body: JSON.stringify({getUrl: presignedUrl})
       }
    } catch (err){
        console.log("Error: ", err)
        return {
            statusCode: 500,
            headers: {
                "Content-Type": 'text/plain',
            },
            body: "ERROR"
        }
    }

};

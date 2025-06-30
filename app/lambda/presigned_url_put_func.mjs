import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';

const s3 = new S3Client()
const bucket = process.env.BUCKET_NAME

export const handler = async (event) => {
    try {
        const scanId = event.headers?.["scan-id"]
        const key = `uploads/${scanId}.zip`

        if(!scanId) {
            return {
                statusCode: 400,
                body: "Missing scanId"
            }
        }
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: "application/zip"
        })
        console.log(`Uploading file ${key} to S3 bucket ${bucket}...`)
        const presignedUrl = await getSignedUrl(s3, command, {expiresIn: 3600})

       return {
        statusCode: 200,
        headers: {
            "Content-Type": 'application/json',
        },
        body: JSON.stringify({uploadUrl: presignedUrl})
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

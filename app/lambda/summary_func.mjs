import {S3Client, GetObjectCommand, PutObjectCommand} from '@aws-sdk/client-s3'

const s3 = new S3Client()

export const handler = async (event) => {
    console.log("EVENT: ", JSON.stringify(event));

    for (const rec of event.Records){
        const bucket = rec.s3.bucket.name
        const key = rec.s3.object.key
        const match = key.match(/trivy_report_(.*)\.json/)
        if (!match){
            console.warn(`Could not extract scanID from ${key}`)
        }

        const scanID = match[1]
        const summaryKey = `summary_reports/trivy_summary_report_${scanID}.json`
        
        try {

            const command = new GetObjectCommand({
                Bucket: bucket,
                Key: key
            });
            const response = await s3.send(command);
            const bytes = await response.Body.transformToByteArray();
            const byteA = Buffer.from(bytes)
            const jsonString = byteA.toString("utf-8")
            const fullReport = JSON.parse(jsonString)

            
            const summaryList = []


            if (fullReport.Results && fullReport.Results.length > 0) {
                for (let result of fullReport.Results){
                    const summary = {
                        file: "",
                        numberOfSeverities: {},
                        highSeverities: []
                    }

                    if (result.Target){
                        summary.file = result.Target
                    }

                    if (result.Misconfigurations && result.Misconfigurations.length > 0){
                        for (let missconfig of result.Misconfigurations) {
                            const severity = missconfig.Severity
                        
                            if (!summary.numberOfSeverities[severity]){
                                summary.numberOfSeverities[severity] = 0
                            }
                            summary.numberOfSeverities[severity]++

                            if (severity == "HIGH" || severity == "CRITICAL") {
                                summary.highSeverities.push({
                                    id: missconfig.ID,
                                    title: missconfig.Title,
                                    severity: severity
                                })
                            }
                        }
                    }

                    summaryList.push(summary)
                    
                }

            }
            const putCommand = new PutObjectCommand({
                Bucket: bucket,
                Key: summaryKey,
                Body: JSON.stringify(summaryList),
                ContentType: "application/json"
            })
            await s3.send(putCommand)
            console.log(`Summary uploaded to ${summaryKey} ...: `)
        } catch (err) {
            console.log("Error", err)
        }
    }
    

};

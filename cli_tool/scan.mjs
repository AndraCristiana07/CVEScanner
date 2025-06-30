import * as fs from 'fs'
import archiver  from "archiver";
import {v4 as uuidv4} from 'uuid';
import { default as axios } from 'axios'
import 'dotenv/config'

const id = uuidv4()

async function getToken(username, password) {
    const res = await fetch(`${process.env.API_URL}/login`, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',

        },
        body: JSON.stringify({username, password})
    })
    if(!res.ok){
        console.error(`Failed to get token`)
        process.exit(1)
    }
    const {token} = await res.json()
    return token
}

async function zipFolder(sourceDir, zipPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath)  
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });
        output.on("close", ()=> resolve());

        archive.on("error", reject);
      
        archive.pipe(output)
        archive.directory(sourceDir, false)
        archive.finalize()

    })
 
}

async function getPreSignedUrl(token) {
    const res = await fetch(`${process.env.API_URL}/presigned`, {
        method: "POST",
        headers: {
            'Authorization': token,
            "scan-id": id
        },
    })
    if(!res.ok){
        console.error(`Failed to get presigned URL`)
        process.exit(1)
    }
    const {uploadUrl} = await res.json()
    return uploadUrl
}

async function getPreSignedGetUrl(token) {
    const res = await fetch(`${process.env.API_URL}/presignedGet`, {
        method: "POST",
        headers: {
            'Authorization': token,
            "scan-id": id
        },
    })
    if(!res.ok){
        console.error(`Failed to get presigned URL`)
        process.exit(1)
    }
    const {getUrl} = await res.json()
    return getUrl
}

async function uploadFileToURL(zipFile, url) {
    try {
        const fileBuffer = fs.readFileSync(zipFile);
        
        const response = await axios.put(url, fileBuffer, {
            contentType: "application/zip"     
        });

        console.log("File upload successful. Response:", response.status);
    } catch (error) {
        console.error("Error uploading file:", JSON.stringify(error));
    }
    
}

async function run(folderPath) {
    if(!folderPath){
        console.error('Provide a folder to scan')
        process.exit(1)
    }

    const zipFile = `${id}.zip`
    console.log("Scan id: ", id)

    console.log("Zipping folder...")
    await zipFolder(folderPath, zipFile)

    const token = await getToken(process.env.NAME, process.env.PASSWORD)
    // console.log(token)

    console.log("Uploading to S3...")
    
    const presignedUrl = await getPreSignedUrl(token)

    await uploadFileToURL(zipFile, presignedUrl)
    console.log(`Scan started with ID: ${id}...`)

    console.log(`Waiting 90 seconds before checking...`)
    await new Promise((r)=> setTimeout(r, 90000))
    await tryFetchSummary(id, token)
}



async function tryFetchSummary(id, token) {
    try {
       
        const getUrl = await getPreSignedGetUrl(token)

        const response = await axios.get(getUrl, {headers: {
            "Content-Type": 'application/json',
        },})
       
        const summaryList = response.data

        let totalSeverities = 0
        for (const summary of summaryList) {
            const file = summary.file
            const highSeverities = summary.highSeverities
            if (highSeverities && highSeverities.length > 0) {
                console.log(`There are ${highSeverities.length} high/critical issues in ${file}`)
                totalSeverities += highSeverities.length
            } else {
                console.log(`File ${file} has no high/critical issues`)
            }
        }
        if (totalSeverities > 0) {
            console.log(`Found ${totalSeverities} high/critical issues overall. Check S3 summary report!`)
        } else {
            console.log(`Found no high/critical issues!!`)
        }
    } catch (err) {
        console.log("Failed to fetch summary: ", JSON.stringify(err))
    }
    
}

const folderForScan = process.argv[2]
await run(folderForScan)


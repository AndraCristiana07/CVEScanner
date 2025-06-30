import {CognitoIdentityProviderClient, InitiateAuthCommand, AdminSetUserPasswordCommand} from '@aws-sdk/client-cognito-identity-provider'

const cognitoClient = new CognitoIdentityProviderClient({region: process.env.REGION})

export const handler = async (event) => {
    try {
   

        const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body
        const username = body.username
        const password = body.password
        const clientID = process.env.CLIENT_ID
        const authCommand = new InitiateAuthCommand({
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: clientID,
            AuthParameters: {
                USERNAME: username,
                PASSWORD: password
            }
        })
        
        const response = await cognitoClient.send(authCommand)

        if (response.ChallengeName == "NEW_PASSWORD_REQUIRED") {
            const changePasswordCommand = new AdminSetUserPasswordCommand({
                UserPoolId: process.env.USER_POOL_ID,
                Username:process.env.NAME,
                Password: process.env.PASSWORD,
                Permanent: true
            })
            await cognitoClient.send(changePasswordCommand)
            return await handler({body: JSON.stringify({username, password})})

        }

        const tok = response.AuthenticationResult?.IdToken
        if (!tok){
            console.log("No token in response", JSON.stringify(response))
            throw new Error("Token not received")
        }

        return {
            statusCode: 200,
           
            body: JSON.stringify({token: tok})
        }
    } catch (err){
        console.log("Error: ", err)
        return {
            statusCode: 401,
            body: "Login failed"
        }
        
    }

};

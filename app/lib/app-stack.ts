import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam'
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as codebuild from 'aws-cdk-lib/aws-codebuild'
import { Construct } from 'constructs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as apigw from 'aws-cdk-lib/aws-apigateway'
import * as dotenv from 'dotenv'
dotenv.config({path: path.resolve(__dirname, '../../cli_tool/.env')})

// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'AppQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
    
    const bucket = new Bucket(
      this,
      "S3Bucket",
      {
        bucketName: "cve-scanner123012f30",
        removalPolicy: cdk.RemovalPolicy.DESTROY, 
        autoDeleteObjects: true,
        websiteIndexDocument: "index.html",
        
        blockPublicAccess: new s3.BlockPublicAccess({
          blockPublicPolicy: false
        })
      }
    )

    bucket.addLifecycleRule({
      prefix: 'uploads/',
      enabled: true,
      expiration: cdk.Duration.days(7)
    })

    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: [`${bucket.bucketArn}/index.html`],
        actions: ['s3:GetObject'],
        principals:[new iam.AnyPrincipal()] //TODO
      })
    )

    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: {
        username: true,
        email: false
      },
      passwordPolicy: {
        minLength: 8,
      }
    })

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: userPool,
      authFlows: {
        userPassword: true
      }
    })
    
    const codebuildRole = new iam.Role(this, "CodeBuildRole", {
      roleName: "CodebuildRole",
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com')

    });
    
    codebuildRole.addToPolicy(
      new iam.PolicyStatement({ resources: [bucket.bucketArn, bucket.bucketArn + "/*"], actions: ["s3:PutObject"] })
    );

    bucket.grantRead(codebuildRole)
   
    const project = new codebuild.Project(this, 'Project', {
      projectName: "CVEScanner",
      role: codebuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_5_0, 
      },
      buildSpec: codebuild.BuildSpec.fromAsset(path.join(__dirname, '../codebuild/buildspec.yml')),
      timeout: cdk.Duration.minutes(5)
    })

    bucket.grantRead(project)

    const lambdaRole = new iam.Role(this, "LambdaRole", {
      roleName: "LambdaRole",
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      
    });

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [project.projectArn],
        actions: ['codebuild:StartBuild']
      })
    )

    lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")
    );

    const startCB = new lambda.Function(this, 'StartCodeBuildFunc', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      timeout: cdk.Duration.seconds(5),
      role: lambdaRole,
      handler: 'lambda_func.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
    });

   

    bucket.grantRead(startCB);

    startCB.addEventSource(new eventsources.S3EventSource(bucket, {
      filters: [{ prefix: 'uploads/', suffix: '.zip' }],
      events: [ s3.EventType.OBJECT_CREATED ],
    }));

    const summaryFn = new lambda.Function(this, 'SummaryFunc', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      timeout: cdk.Duration.seconds(5),
      role: lambdaRole,
      handler: 'summary_func.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
    });

    summaryFn.addEventSource(new eventsources.S3EventSource(bucket, {
      filters: [{ suffix: '.json', prefix:'reports/' }],
      events: [ s3.EventType.OBJECT_CREATED, s3.EventType.OBJECT_REMOVED ],
    }));

    bucket.grantRead(summaryFn)
    bucket.grantPut(summaryFn)

    const api = new apigw.RestApi(this, "RestAPI", {
      binaryMediaTypes: ['application/zip'],
      minimumCompressionSize: 0,
      defaultCorsPreflightOptions: {
        allowMethods: ['OPTIONS', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        allowCredentials: true,
        allowOrigins: apigw.Cors.ALL_ORIGINS
      }
    })


    const executeRole = new iam.Role(this, "APIGWRole", {
      roleName: "APIGWRole",
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      
    });
    executeRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [bucket.bucketArn],
        actions: ['s3:Get']
      })
    )

    bucket.grantReadWrite(executeRole)

    const auth = new apigw.CognitoUserPoolsAuthorizer(this, "Authorizer", {
      cognitoUserPools: [userPool],
      identitySource: "method.request.header.Authorization"
    })

    const scanResource = api.root.addResource('scan')
    scanResource.addMethod("POST", new apigw.LambdaIntegration(startCB), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: auth
    })

    const summaryResource = api.root.addResource('summary')
    summaryResource.addMethod("PUT", new apigw.LambdaIntegration(summaryFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: auth
    })

    const getPresignedUrlForPutFn =  new lambda.Function(this, 'PresignedUrlFunc', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      timeout: cdk.Duration.seconds(5),
      role: lambdaRole,
      handler: 'presigned_url_put_func.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
    });

    getPresignedUrlForPutFn.addEnvironment("BUCKET_NAME", bucket.bucketName)
    bucket.grantPut(getPresignedUrlForPutFn)
    bucket.grantPutAcl(getPresignedUrlForPutFn)
    
    
    const presignedResource = api.root.addResource('presigned')
    presignedResource.addMethod("POST", new apigw.LambdaIntegration(getPresignedUrlForPutFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: auth
    })


    const getPresignedUrlForGetFn =  new lambda.Function(this, 'PresignedUrlGetFunc', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      timeout: cdk.Duration.seconds(5),
      role: lambdaRole,
      handler: 'presigned_url_get_func.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
    });

    getPresignedUrlForGetFn.addEnvironment("BUCKET_NAME", bucket.bucketName)
    bucket.grantPut(getPresignedUrlForGetFn)
    bucket.grantRead(getPresignedUrlForGetFn)

    
    const presignedGetResource = api.root.addResource('presignedGet')
    presignedGetResource.addMethod("POST", new apigw.LambdaIntegration(getPresignedUrlForGetFn), {
      authorizationType: apigw.AuthorizationType.COGNITO,
      authorizer: auth
    })

    const loginFn =  new lambda.Function(this, 'LoginFunc', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      timeout: cdk.Duration.seconds(5),
      role: lambdaRole,
      handler: 'login_func.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
    });

    loginFn.addEnvironment("REGION", process.env.REGION!)
    loginFn.addEnvironment("CLIENT_ID", process.env.CLIENT_ID!)
    loginFn.addEnvironment("USER_POOL_ID", process.env.USER_POOL_ID!)
    

    bucket.grantPut(loginFn)
    
    const loginResource = api.root.addResource('login')
    loginResource.addMethod("POST", new apigw.LambdaIntegration(loginFn), {
      authorizationType: apigw.AuthorizationType.NONE,
    })


    const totalVulnerabilitiesFn = new lambda.Function(this, 'TotalVulnerabilitiesFunc', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      timeout: cdk.Duration.seconds(5),
      role: lambdaRole,
      handler: 'get_total_vulnerabilities_func.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
    });
    totalVulnerabilitiesFn.addEnvironment("REGION", process.env.REGION!)
    totalVulnerabilitiesFn.addEnvironment("BUCKET_NAME", bucket.bucketName)
    bucket.grantRead(totalVulnerabilitiesFn)

    const totalVulnerabilitiesResource = api.root.addResource('summary-total')
    totalVulnerabilitiesResource.addMethod("GET", new apigw.LambdaIntegration(totalVulnerabilitiesFn), {
      authorizationType: apigw.AuthorizationType.NONE,
    })

    new cdk.CfnOutput(this, 'UserPoolId', { key: 'UserPoolId', value: userPool.userPoolId })
    new cdk.CfnOutput(this, 'UserPoolClientId', { key: 'UserPoolClientId', value: userPoolClient.userPoolClientId })
    new cdk.CfnOutput(this, 'apiUrl', {key:'apiUrl', value: api.url});
    new cdk.CfnOutput(this, "WebsiteURL", { value: bucket.bucketWebsiteUrl });


  }
}

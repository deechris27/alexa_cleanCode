let bcrypt = require('bcryptjs');
let AWS = require('aws-sdk');
let dbClient = new AWS.DynamoDB.DucumentClient();

let intentions = {};

exports.handler = async (event)=>{

     let request = event.request;
     let ph = parseInt(event.request.intent.slots.phoneNumber.value);
     let session = event.session;
     let pass = Number(event.request.intent.slots.passcode.value); 
     let response = new forAlexa();

       if(request.intent.type === 'LaunchRequest'){
           // launchReq(request, session, ph);
       }else if(request.intent.type === 'IntentRequest'){
            if(request.intent.name in intentions){
                intentions[request.intent.name](request, response, session, ph, pass);
            }else{
                response.outputSpeech = "Requested Service not found";
                response.shouldEndSession = true;
                response.done();
            }
       }
     
}


//add a function for checkclaimintent into the intentions object
intentions.CheckClaimIntent = function(request, response, session, ph, pass){

         //user invoked check claim but no passcode; fetch user details from db and save passcode in session
         getPasscode(ph).then(data=>{
             if(data){
                 //save passcode in session, prompt user to say the passcode to invoke auth intent
                 response.outputSpeech = `Please tell me your passcode for authentication <break time="0.5s"/>`;
                 response.repromptSpeech = `For example, you could say <say-as interpret-as="digits">123456</say-as>`;
                 session.attributes.CheckClaimIntent = true; //only needed to provide more services in the same session
                 session.attributes.passcode = data.passcode;
             }else{
                 //if no error and no password returned from db; prompt user to invoke set passcode intent
                response.outputSpeech = `Passcode not set, please set a passcode to avail voice assistance services<break time="0.5s"/>`;
                response.repromptSpeech = `For example, you could say <break time="0.2s"/> set my passcode to <say-as interpret-as="digits">12345</say-as>`;
             }

             response.shouldEndSession = false; 
             response.done();
         }).catch(error=>{
             response.fail(error);
         });

      if(session.attributes.passcode!=""){
            authenticateUser(session.attributes.passcode, pass, ph);
    }
}

intentions.AuthenticationIntent = function(request, response, session, ph, pass){
      authenticateUser(response, session.attributes.passcode, ph, pass);
}

intentions.SetPasscodeIntent = function(response, session, ph, pass){
     getPasscode(ph).then(data=>{
         if(data.passcode===""){
             createPasscode(response, session, ph, pass).then(status=>{
                response.outputSpeech = `Succefully updated passcode to <say-as interpret-as="digits">${pass}</say-as>`;
                response.shouldEndSession = true;
                response.done();
             }).catch(error=>{
                 response.fail(error);
             });
         }
     }).catch(error=>{
         response.fail(error);
     });
}

//stop Intent function to end the session
intentions['AMAZON.StopIntent'] = function(response){
       response.outputSpeech = `Good Bye!`;
       response.shouldEndSession = true;
       response.done();
}

//A function expression to add properties of the response object
let response = function forAlexa(){
    this.outputSpeech = "";
    this.repromptSpeech = "";
    this.shouldEndSession = true; 

    this.done = function(params){
        this.outputSpeech = (params && params.outputSpeech) ? params.outputSpeech : "";
        this.repromptSpeech = (params && params.repromptSpeech) ? params.repromptSpeech : "";
        this.shouldEndSession = (params && params.shouldEndSession) ? params.shouldEndSession : "";

        Promise.resolve(createResponseForAlexa(this));
    }

    this.fail = function(error){
        Promise.reject(error);
    }
}

//take response properties and return a response object to be sent to alexa
function createResponseForAlexa(params){
    let alexaResponse = {
        version: '1.0',
        response: {
            outputSpeech: {
                Type: 'SSML',
                ssml: params.outputSpeech
            }
        }
    };

    if(params.repromptSpeech){
        alexaResponse.response.repromptSpeech = {
            Type: 'SSML',
            ssml: params.repromptSpeech
        }
    }

    return alexaResponse;
}

//quesry the db and return user details promise
async function getPasscode(ph){
     let forDB = {
         TableName: 'UserData',
         Key:{
             'UserId': ph
         }
     };

     let dbdata = await dbClient.get(forDB).Promise()
                        .then(data=>{
                          if(data===""){
                              return false; //if passcode returns empty then user hasn't set his passcode
                          }else{
                              return data.Item;
                          }
                        }).catch(error=>error);

        return dbdata;
}

//compare passwords provide requested services else deny and end session 
function authenticateUser(sessionPasscode, pass, ph){
     let savedPasscode = sessionPasscode;
     let utteredPasscode = pass;

     bcrypt.compare(savedPasscode, utteredPasscode).then((data)=>{
          if(session.attributes.CheckClaimIntent){
              getPasscode(ph).then((dbdata)=>{
                response.outputSpeech = `Your claim status is ${dbdata.claim_status} <break time="0.5s"/>`;
                response.repromptSpeech = `Do you need anything else? <break time="0.2s"/>`;
                response.shouldEndSession = true;
                response.done();
              });
          }
     }).catch(error=>{
        response.outputSpeech = `The passcode <say-as interpret-as>${utteredPasscode}<say-as> is incorrect <break time="0.5s"/>`;
        response.repromptSpeech = `Please check and try again! <break time="0.2s"/> Good Bye!`;
        response.shouldEndSession = true;
        response.done();
     });
}

//queries db, greets user with his name as per his timezone.
function launchReq(request, response, session, ph){
     getPasscode(ph).then(data=>{
         if(data){
            response.outputSpeech = `Hello ${data.name}! <emphasis level="strong"> ${greet()} </emphasis> welcome to ****** voice assitant services. <break time="0.5s"/>`;
            response.repromptSpeech = `What can I do for you? <break time="0.2s"/> You could say check claim status`;
            response.shouldEndSession = false;
            session.attributes.userName = data.name;
            response.done();
         }else if(data===""){
            response.outputSpeech = `User does not exist <break time="0.5s"/>`;
            response.repromptSpeech = "Please check your mobile number and try again";
            response.shouldEndSession = true;
            response.done();
         }
     }).catch(error=>{
           response.fail(error);
     });
}


function greet(){
    let myDate = new Date();
    let hours = myDate.getUTCHours() + 5.5; //IST
    let greetMsg = (hours>=12 && hours<16) ? "Good Afternoon!" : (hours<12 && hours>=5) ? "Good Morning!" : (hours>=16 && hours<19) ? "Good Evening!" : "Good Day!";
    return greetMsg;
}

async function createPasscode(response, session, ph, pass){

    let passcodeHash = bcrypt.hashSync(pass, 10);

    let forDB = {
        TableName: 'UserDate',
        Key:{
            'userId': ph
        },
        UpdateExpression: "set passcode = :p",
        ExpressionAtrributeValues: {
            ":p":passcodeHash
        },
        ReturnValues: "UPDATED_NEW"

    };

    let updateStatus = await dbClient.put(forDB).Promise()
                        .then(data=>{
                            return true;
                        }).catch(error=>{
                            return false;
                        });
                            
}
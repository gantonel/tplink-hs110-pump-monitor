require('dotenv').config()
const powerThreshold = process.env.POWER_THRESHOLD;
const aliasDevice = process.env.ALIAS_DEVICE;
const emailSender = process.env.EMAIL_SENDER;
const passEmailSender = process.env.PASS_EMAIL_SENDER;
const emailReceiver = process.env.EMAIL_RECEIVER;
const logFileName = process.env.LOG_FILENAME;
const maxIdle = process.env.IDLE_THRESHOLD;
const repeatMaxIdleAlertEvery = process.env.REPEAT_IDLE_ALERT_EVERY;
const maxRun = process.env.DEVICE_RUNNING_TIME_THRESHOLD;
const repeatMaxRunAlertEvery = process.env.REPEAT_RUNNING_ALERT_EVERY;



const nbLineLogEmail = process.env.NB_LINE_LOG_EMAIL;

//Cloud Api specific params
const apiSelection = process.env.API_SELECTION;
const userTpLink = process.env.USER_TPLINK;
const passTpLink = process.env.PASS_TPLINK;
const waitBetweenRead = process.env.WAIT_BETWEEN_READ;

//Init logger
var log4js = require('log4js');
log4js.configure({
  appenders: {
    out: { type: 'console' }, 
    info: { type: 'file', filename: './' + logFileName + '.log' },
    debug: { type: 'file', filename: './' + logFileName + '_debug.log' }
  },
  categories: {
    default: { appenders: ['out','info'], level: 'info' },
    debug: { appenders: ['out','debug'], level: 'info' }
  }
  });    
const logger = log4js.getLogger('default'); 
const loggerDebug = log4js.getLogger('debug'); 

//Init nodemailer
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: emailSender,
      pass: passEmailSender
    }
  });  

var monitoredDevice = {
  started: false,
  lastStartedTime: undefined,
  lastStoppedTime: undefined,
  lastTimeInactivityAlert: undefined,
  lastTimeRunningAlert: undefined,
  usage: undefined,
  getPower: function() {
    return ('power' in monitoredDevice.usage ? monitoredDevice.usage.power : monitoredDevice.usage.power_mw/1000);
  },
  init: function() {
    this.started = false;
    this.lastStartedTime = getDate();
    this.lastStoppedTime = getDate();
    this.lastTimeInactivityAlert = getDate();
    this.someInactivityAlertSent = false;
    this.lastTimeRunningAlert = getDate();
    this.someTimeRunningAlertSent = false;
    this.usage = undefined;
  },
  isDeviceStarted: function() { return this.started; },
  isDeviceStopped: function() { return !this.started; },
  startDevice: function() { 
    this.started = true;
    logger.info(aliasDevice + " Started" + JSON.stringify(monitoredDevice.usage));
    sendEmail(aliasDevice + " Started");
    this.lastStartedTime = getDate(); 
    this.someTimeRunningAlertSent = false;
  },
  stopDevice: function() {
    this.started = false;
    logger.info(aliasDevice + " Stopped" + JSON.stringify(monitoredDevice.usage));
    sendEmail(aliasDevice + " Stopped");
    this.lastStoppedTime = getDate();  
    this.someInactivityAlertSent = false;
  }   
}

async function main() {   
  loggerDebug.info("Acceptable Inactivity             : " + (maxIdle/60).toFixed(2) + " minutes");
  loggerDebug.info("Alert for  Inactivity every       : " + (repeatMaxIdleAlertEvery/60).toFixed(2) + " minutes");
  loggerDebug.info("Acceptable Activity               : " + (maxRun/60).toFixed(2) + " minutes");
  loggerDebug.info("Alert for Excessive activity every: " + (repeatMaxRunAlertEvery/60).toFixed(2) + " minutes");
    
  logger.info("Acceptable Inactivity             : " + (maxIdle/60).toFixed(2) + " minutes");
  logger.info("Alert for  Inactivity every       : " + (repeatMaxIdleAlertEvery/60).toFixed(2) + " minutes");
  logger.info("Acceptable Activity               : " + (maxRun/60).toFixed(2) + " minutes");
  logger.info("Alert for Excessive activity every: " + (repeatMaxRunAlertEvery/60).toFixed(2) + " minutes");

  monitoredDevice.init();

  if(apiSelection == "cloud") {
    cloudApi();
    	logger.info("-----Monitoring started!-----");
  		logger.info("-----  using CLOUD API  -----");
    	loggerDebug.info("-----Monitoring started!-----");
  		loggerDebug.info("-----  using CLOUD API  -----");

  } 
  else {
    lanApi();
    	logger.info("-----Monitoring started!-----");
  		logger.info("-----   using LAN API   -----");
    	loggerDebug.info("-----Monitoring started!-----");
  		loggerDebug.info("-----   using LAN API   -----");

  }    
}

function lanApi() {
  const { Client } = require('tplink-smarthome-api');
  const client = new Client();

  client.startDiscovery().on('device-new', (plug) => {
    if (plug.alias == aliasDevice) {
      plug.on('emeter-realtime-update', monitoring);
    }    
  });
}

async function cloudApi() {          
  const { login } = require("tplink-cloud-api");    
      
  try {
    var tplink = await login(userTpLink, passTpLink)
    await tplink.getDeviceList();
  }
  catch (err) {
    loggerDebug.info(err); 
    return;
  } 

  try {
    var device = tplink.getHS110(aliasDevice);
  }  
  catch(err) {
    loggerDebug.info(aliasDevice + " " + err);
    return;
  }
    
  while (true) {
    try {
      monitoredDevice.usage = await device.getPowerUsage();
      
      monitoring(monitoredDevice.usage)
      
      await sleep(waitBetweenRead);  
    }
    catch (err) {
      loggerDebug.info(err);
      break; 
    }      
  }    
}

const monitoring = function(usage) {
  try {
    monitoredDevice.usage = usage;   
    
    loggerDebug.info(JSON.stringify(usage));
    verifyStartStop();
    verifyLastTimeStarted();
    verifyRunningTime();
  }
  catch (err) {
    loggerDebug.info(err);
  } 
}

function verifyLastTimeStarted() { 
  sinceInactivityAlert = getDate() - monitoredDevice.lastTimeInactivityAlert;
  sinceLastStop = getDate() - monitoredDevice.lastStoppedTime;
  msg = aliasDevice + " didn't start for the last " + (sinceLastStop/60).toFixed(2) + " minutes";
  if (monitoredDevice.isDeviceStopped()) {
    if ( (monitoredDevice.someInactivityAlertSent && (sinceInactivityAlert >= repeatMaxIdleAlertEvery))|| (!monitoredDevice.someInactivityAlertSent &&(sinceLastStop >= maxIdle))) {      
      loggerDebug.info(msg);
      logger.info(msg);
      sendEmail(msg);
      monitoredDevice.lastTimeInactivityAlert = getDate();
      monitoredDevice.someInactivityAlertSent = true;
    }
  }
}

function verifyStartStop() {
  let power = ('power' in monitoredDevice.usage ? monitoredDevice.usage.power : monitoredDevice.usage.power_mw);  
  if (power > powerThreshold) {            
    if (monitoredDevice.isDeviceStopped()) {
        monitoredDevice.startDevice();        
    }
  }
  else if (monitoredDevice.isDeviceStarted()) {    
      monitoredDevice.stopDevice();
  }
}

function verifyRunningTime() {
  var sinceAlert = getDate() - monitoredDevice.lastTimeRunningAlert;
  var sinceStart = getDate() - monitoredDevice.lastStartedTime;
  var msg = aliasDevice + " running for more then " + (sinceStart/60).toFixed(2) + " minutes";
  if (monitoredDevice.isDeviceStarted()) {
  	if ((monitoredDevice.someTimeRunningAlertSent && (sinceAlert >= repeatMaxRunAlertEvery))|| (!monitoredDevice.someTimeRunningAlertSent && (sinceStart >= maxRun))) {
      loggerDebug.info(msg);
      logger.info(msg);
      sendEmail(msg);
      monitoredDevice.lastTimeRunningAlert = getDate();
      monitoredDevice.someTimeRunningAlertSent = true;
    }
  }
}

function sleep(s) {
  return new Promise(resolve => setTimeout(resolve, s*1000), rejected => {});
}

function getDate() {
  return Date.now()/1000;
}

function readLogFile() {
  var fs = require('fs');

  return new Promise(function(resolve, reject) {
    fs.readFile(logFileName + '.log', 'utf8', function(err, data) {
        if(err) { 
            reject(err);  
        }
        else {              
            resolve(data);
        }
      });
  });
}

async function logToEmail() {
  let dataLog = await readLogFile()  
  .then(data => {
    return data.toString().split("\n");
  })
  .catch(err => {
    throw(err);
  });  

  dataLog = dataLog.slice(Math.max(dataLog.length - nbLineLogEmail, 0));  
  dataLog = dataLog.reverse();
  dataLog = dataLog.toString().replace(/,/g, "\n");  

  return dataLog;  
}
  
async function sendEmail(message) {

  let bodyMessage = await logToEmail();

  var mailOptions = {
      from: emailSender,
      to: emailReceiver,
      subject: message,
      text: bodyMessage
    };
  transporter.sendMail(mailOptions, function(error, info){
      if (error) {
        loggerDebug.info(error);
      } else {
        loggerDebug.info(message + ' Email sent: ' + info.response);
      }
    });
}

main();

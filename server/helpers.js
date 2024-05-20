const WebSocket = require('ws');
const dataHandler = require('./datahandler');
const storage = require('./storage');
const consoleCmd = require('./console');

function parseMarkdown(parsed) {
  parsed = parsed.replace(/<\/?[^>]+(>|$)/g, '');
  
  var grayTextRegex = /--(.*?)--/g;
  parsed = parsed.replace(grayTextRegex, '<span class="text-gray">$1</span>');
  
  var boldRegex = /\*\*(.*?)\*\*/g;
  parsed = parsed.replace(boldRegex, '<strong>$1</strong>');
  
  var italicRegex = /\*(.*?)\*/g;
  parsed = parsed.replace(italicRegex, '<em>$1</em>');
  
  var linkRegex = /\[([^\]]+)]\(([^)]+)\)/g;
  parsed = parsed.replace(linkRegex, '<a href="$2">$1</a>');
  
  parsed = parsed.replace(/\n/g, '<br>');
  
  return parsed;
}

function removeMarkdown(parsed) {
  parsed = parsed.replace(/<\/?[^>]+(>|$)/g, '');
  
  var grayTextRegex = /--(.*?)--/g;
  parsed = parsed.replace(grayTextRegex, '$1');
  
  var boldRegex = /\*\*(.*?)\*\*/g;
  parsed = parsed.replace(boldRegex, '$1');
  
  var italicRegex = /\*(.*?)\*/g;
  parsed = parsed.replace(italicRegex, '$1');
  
  var linkRegex = /\[([^\]]+)]\(([^)]+)\)/g;
  parsed = parsed.replace(linkRegex, '$1');
  
  return parsed;
}

function formatUptime(uptimeInSeconds) {
  const secondsInMinute = 60;
  const secondsInHour = secondsInMinute * 60;
  const secondsInDay = secondsInHour * 24;
  
  const days = Math.floor(uptimeInSeconds / secondsInDay);
  const hours = Math.floor((uptimeInSeconds % secondsInDay) / secondsInHour);
  const minutes = Math.floor((uptimeInSeconds % secondsInHour) / secondsInMinute);
  
  return `${days}d ${hours}h ${minutes}m`;
}

let incompleteDataBuffer = '';

function resolveDataBuffer(data, wss) {
  var receivedData = incompleteDataBuffer + data.toString();
  const isIncomplete = (receivedData.slice(-1) != '\n');
  
  if (isIncomplete) {
    const position = receivedData.lastIndexOf('\n');
    if (position < 0) {
      incompleteDataBuffer = receivedData;
      receivedData = '';
    } else {
      incompleteDataBuffer = receivedData.slice(position + 1);
      receivedData = receivedData.slice(0, position + 1);
    }
  } else {
    incompleteDataBuffer = '';
  }
  
  if (receivedData.length) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        dataHandler.handleData(client, receivedData);
      }
    });
  }
}

function kickClient(ipAddress) {
  // Find the entry in connectedClients associated with the provided IP address
  const targetClient = storage.connectedUsers.find(client => client.ip === ipAddress);
  console.log(storage.connectedUsers);
  if (targetClient && targetClient.instance) {
    // Send a termination message to the client
    targetClient.instance.send('KICK');
    
    // Close the WebSocket connection after a short delay to allow the client to receive the message
    setTimeout(() => {
      targetClient.instance.close();
      consoleCmd.logInfo(`Web client kicked (${ipAddress})`);
    }, 500);
  } else {
    consoleCmd.logInfo(`Kicking client ${ipAddress} failed. No suitable client found.`);
  }
}

module.exports = {
  parseMarkdown, removeMarkdown, formatUptime, resolveDataBuffer, kickClient
}
import 'dotenv/config';
import twilio from 'twilio';
import transferConfig from './config/transfer-config';

const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

if (!accountSid || !authToken) {
  console.error('❌ Missing Twilio credentials!');
  console.error('Account SID:', accountSid ? '✅ Set' : '❌ Missing');
  console.error('Auth Token:', authToken ? '✅ Set' : '❌ Missing');
  process.exit(1);
}

if (!accountSid.startsWith('AC')) {
  console.error('⚠️  Warning: Account SID should start with "AC"');
}

const client = twilio(accountSid, authToken);

/**
 * Initiates a phone call using Twilio
 */
async function initiateCall(to: string, from: string, url: string) {
  try {
    const call = await client.calls.create({
      to: to,
      from: from,
      url: url,
    });

    console.log('Call initiated successfully!');
    console.log('Call SID:', call.sid);
    console.log('Status:', call.status);
    return call;
  } catch (error: any) {
    console.error('Error initiating call:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
    if (error.moreInfo) {
      console.error('More info:', error.moreInfo);
    }
    throw error;
  }
}

/**
 * Fetches the current status and details of a call
 */
async function getCallStatus(callSid: string) {
  try {
    const call = await client.calls(callSid).fetch();
    return call;
  } catch (error: any) {
    console.error('Error fetching call status:', error.message);
    throw error;
  }
}

/**
 * Monitors a call and checks its status periodically
 */
async function monitorCall(callSid: string, intervalMs: number = 2000, maxChecks: number = 10) {
  console.log(`\nMonitoring call ${callSid}...`);
  
  for (let i = 0; i < maxChecks; i++) {
    try {
      const call = await getCallStatus(callSid);
      console.log(`\n[Check ${i + 1}/${maxChecks}] Status: ${call.status}`);
      
      if (call.status === 'completed' || call.status === 'failed' || call.status === 'busy' || call.status === 'no-answer' || call.status === 'canceled') {
        console.log('\n=== Final Call Details ===');
        console.log('Status:', call.status);
        console.log('Duration:', call.duration ? `${call.duration} seconds` : 'N/A');
        console.log('Price:', call.price ? `$${call.price} ${call.priceUnit}` : 'N/A');
        return call;
      }
      
      if (i < maxChecks - 1) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    } catch (error: any) {
      console.error('Error monitoring call:', error.message);
      throw error;
    }
  }
  
  console.log('\n⚠️  Max checks reached. Call may still be in progress.');
  return await getCallStatus(callSid);
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  let callSidToCheck: string | null = args[0] || null;
  
  if (callSidToCheck && callSidToCheck.trim() === '') {
    callSidToCheck = null;
  }
  
  if (callSidToCheck) {
    console.log(`Checking status of call: ${callSidToCheck}`);
    getCallStatus(callSidToCheck)
      .then((call) => {
        console.log('\n=== Call Details ===');
        console.log('Status:', call.status);
        console.log('To:', call.to);
        console.log('From:', call.from);
        console.log('Duration:', call.duration ? `${call.duration} seconds` : 'N/A');
        console.log('Price:', call.price ? `$${call.price} ${call.priceUnit}` : 'N/A');
      })
      .catch((error: any) => {
        console.error('Failed to check call status:', error);
        process.exit(1);
      });
  } else {
    const to = process.env.TO_PHONE_NUMBER || '+1234567890';
    const from = process.env.TWILIO_PHONE_NUMBER || '+1234567890';
    let url = process.env.TWIML_URL || 'http://demo.twilio.com/docs/voice.xml';
    
    const config = transferConfig.createConfig({
      transferNumber: process.env.TRANSFER_PHONE_NUMBER,
      userPhone: process.env.USER_PHONE_NUMBER,
      userEmail: process.env.USER_EMAIL,
      callPurpose: args[1] || 'speak with a representative',
      customInstructions: args[2] || ''
    });
    
    if (url.includes('ngrok') || url.includes('localhost') || url.includes('http')) {
      url = url.endsWith('/') ? url + 'voice' : url + '/voice';
      const params = new URLSearchParams({
        transferNumber: config.transferNumber,
        callPurpose: config.callPurpose || 'speak with a representative'
      });
      if (config.customInstructions) {
        params.append('customInstructions', config.customInstructions);
      }
      url += '?' + params.toString();
    }
    
    console.log('\n📋 Transfer-Only Call Configuration:');
    console.log('  To:', to);
    console.log('  From:', from);
    console.log('  Transfer Number:', config.transferNumber);
    console.log('  Call Purpose:', config.callPurpose);
    console.log('  Webhook URL:', url);
    console.log('  Account SID:', accountSid.substring(0, 10) + '...');

    initiateCall(to, from, url)
      .then(async (call) => {
        console.log('\nCall details:', call);
        console.log('\nWaiting a moment, then checking call status...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        await monitorCall(call.sid);
      })
      .catch((error: any) => {
        console.error('Failed to initiate call:', error);
        process.exit(1);
      });
  }
}

export { initiateCall, getCallStatus, monitorCall };


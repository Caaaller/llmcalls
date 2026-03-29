import 'dotenv/config';
import transferConfig from './config/transfer-config';
import telnyxService from './services/telnyxService';
import { encodeClientState } from './types/telnyx';
import { getErrorMessage } from './utils/errorUtils';

const apiKey = process.env.TELNYX_API_KEY?.trim();
const connectionId = process.env.TELNYX_CONNECTION_ID?.trim();

if (!apiKey || !connectionId) {
  console.error('❌ Missing Telnyx credentials!');
  console.error('TELNYX_API_KEY:', apiKey ? '✅ Set' : '❌ Missing');
  console.error(
    'TELNYX_CONNECTION_ID:',
    connectionId ? '✅ Set' : '❌ Missing'
  );
  process.exit(1);
}

const TERMINAL_STATES = ['hangup', 'failed', 'busy', 'no-answer', 'canceled'];

/**
 * Initiates a phone call using Telnyx
 */
async function initiateCall(
  to: string,
  from: string,
  webhookUrl: string,
  clientState: string
) {
  try {
    const call = await telnyxService.initiateCall(
      to,
      from,
      clientState,
      webhookUrl
    );
    console.log('Call initiated successfully!');
    console.log('Call Control ID:', call.sid);
    console.log('Status:', call.status);
    return call;
  } catch (error: unknown) {
    console.error('Error initiating call:', getErrorMessage(error));
    throw error;
  }
}

/**
 * Fetches the current status and details of a call
 */
async function getCallStatus(callControlId: string) {
  try {
    const response = await telnyxService.getCallStatus(callControlId);
    const data = response.data as { state?: string };
    return { state: data?.state || 'unknown' };
  } catch (error: unknown) {
    console.error('Error fetching call status:', getErrorMessage(error));
    throw error;
  }
}

/**
 * Monitors a call and checks its status periodically
 */
async function monitorCall(
  callControlId: string,
  intervalMs: number = 2000,
  maxChecks: number = 10
) {
  console.log(`\nMonitoring call ${callControlId}...`);

  for (let i = 0; i < maxChecks; i++) {
    try {
      const call = await getCallStatus(callControlId);
      console.log(`\n[Check ${i + 1}/${maxChecks}] State: ${call.state}`);

      if (TERMINAL_STATES.includes(call.state)) {
        console.log('\n=== Final Call State ===');
        console.log('State:', call.state);
        return call;
      }

      if (i < maxChecks - 1) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    } catch (error: unknown) {
      console.error('Error monitoring call:', getErrorMessage(error));
      throw error;
    }
  }

  console.log('\n⚠️  Max checks reached. Call may still be in progress.');
  return await getCallStatus(callControlId);
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  let callControlIdToCheck: string | null = args[0] || null;

  if (callControlIdToCheck && callControlIdToCheck.trim() === '') {
    callControlIdToCheck = null;
  }

  if (callControlIdToCheck) {
    console.log(`Checking status of call: ${callControlIdToCheck}`);
    getCallStatus(callControlIdToCheck)
      .then(call => {
        console.log('\n=== Call Details ===');
        console.log('State:', call.state);
      })
      .catch(error => {
        console.error('Failed to check call status:', error);
        process.exit(1);
      });
  } else {
    const to = process.env.TO_PHONE_NUMBER || '+1234567890';
    const from = process.env.TELNYX_PHONE_NUMBER || '+1234567890';
    const baseUrl =
      process.env.TELNYX_WEBHOOK_URL || process.env.BASE_URL || '';
    const webhookUrl = baseUrl.endsWith('/voice')
      ? baseUrl
      : `${baseUrl}/voice`;

    const config = transferConfig.createConfig({
      transferNumber: process.env.TRANSFER_PHONE_NUMBER,
      userPhone: process.env.USER_PHONE_NUMBER,
      userEmail: process.env.USER_EMAIL,
      callPurpose:
        args[1] || process.env.CALL_PURPOSE || 'speak with a representative',
      customInstructions: args[2] || '',
    });

    const clientState = encodeClientState({
      transferNumber: config.transferNumber,
      callPurpose: config.callPurpose || 'speak with a representative',
      customInstructions: config.customInstructions || '',
    });

    console.log('\n📋 Call Configuration:');
    console.log('  To:', to);
    console.log('  From:', from);
    console.log('  Transfer Number:', config.transferNumber);
    console.log('  Call Purpose:', config.callPurpose);
    console.log('  Webhook URL:', webhookUrl);

    initiateCall(to, from, webhookUrl, clientState)
      .then(async call => {
        console.log('\nCall details:', call);
        console.log('\nWaiting a moment, then checking call status...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        await monitorCall(call.sid);
      })
      .catch(error => {
        console.error('Failed to initiate call:', error);
        process.exit(1);
      });
  }
}

export { initiateCall, getCallStatus, monitorCall };

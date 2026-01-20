require('dotenv').config();
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

console.log('🔍 Testing Twilio Credentials...\n');

if (!accountSid || !authToken) {
  console.error('❌ Missing credentials!');
  console.log('Account SID:', accountSid ? '✅ Set' : '❌ Missing');
  console.log('Auth Token:', authToken ? '✅ Set' : '❌ Missing');
  process.exit(1);
}

console.log('Account SID:', accountSid);
console.log('Auth Token:', authToken.substring(0, 10) + '...' + authToken.substring(authToken.length - 4));
console.log('Account SID length:', accountSid.length, '(should be 34)');
console.log('Auth Token length:', authToken.length, '(should be 32)');
console.log('');

// Test credentials by fetching account info
const client = twilio(accountSid, authToken);

client.api.accounts(accountSid)
  .fetch()
  .then(account => {
    console.log('✅ Credentials are VALID!');
    console.log('Account Name:', account.friendlyName);
    console.log('Account Status:', account.status);
    console.log('Account Type:', account.type);
    console.log('');
    console.log('🎉 You can now make calls!');
  })
  .catch(error => {
    console.error('❌ Credentials are INVALID!');
    console.error('Error:', error.message);
    console.error('Error Code:', error.code);
    console.error('');
    console.log('💡 Solutions:');
    console.log('1. Double-check your Account SID and Auth Token in Twilio Console:');
    console.log('   https://console.twilio.com/us1/account/settings/credentials');
    console.log('2. Make sure there are no extra spaces or quotes in your .env file');
    console.log('3. Verify you copied the credentials from the correct Twilio account');
    console.log('4. Check that your account is active (not suspended)');
    process.exit(1);
  });



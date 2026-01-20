/**
 * Example Usage
 * Demonstrates how to use the API to initiate calls with different scenarios
 */

const axios = require('axios'); // You'll need to install this: npm install axios

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Example 1: Get all available scenarios
 */
async function getScenarios() {
  try {
    const response = await axios.get(`${BASE_URL}/api/scenarios`);
    console.log('Available scenarios:', response.data);
    return response.data.scenarios;
  } catch (error) {
    console.error('Error fetching scenarios:', error.message);
  }
}

/**
 * Example 2: Get specific scenario details
 */
async function getScenarioDetails(scenarioId) {
  try {
    const response = await axios.get(`${BASE_URL}/api/scenarios/${scenarioId}`);
    console.log(`Scenario "${scenarioId}":`, response.data);
    return response.data.scenario;
  } catch (error) {
    console.error(`Error fetching scenario "${scenarioId}":`, error.message);
  }
}

/**
 * Example 3: Initiate a call with doctor appointment scenario
 */
async function initiateDoctorAppointmentCall(to) {
  try {
    const response = await axios.post(`${BASE_URL}/api/calls/initiate`, {
      to: to,
      scenarioId: 'doctor-appointment',
      from: process.env.TWILIO_PHONE_NUMBER
    });
    console.log('Call initiated:', response.data);
    return response.data.call;
  } catch (error) {
    console.error('Error initiating call:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

/**
 * Example 4: Initiate a call with Walmart support scenario
 */
async function initiateWalmartSupportCall(to) {
  try {
    const response = await axios.post(`${BASE_URL}/api/calls/initiate`, {
      to: to,
      scenarioId: 'walmart-support',
      from: process.env.TWILIO_PHONE_NUMBER
    });
    console.log('Call initiated:', response.data);
    return response.data.call;
  } catch (error) {
    console.error('Error initiating call:', error.message);
  }
}

// Run examples
if (require.main === module) {
  (async () => {
    console.log('=== Example 1: Get All Scenarios ===');
    await getScenarios();
    
    console.log('\n=== Example 2: Get Scenario Details ===');
    await getScenarioDetails('doctor-appointment');
    
    console.log('\n=== Example 3: Initiate Doctor Appointment Call ===');
    // Uncomment and add phone number to test:
    // await initiateDoctorAppointmentCall('+1234567890');
    
    console.log('\n=== Example 4: Initiate Walmart Support Call ===');
    // Uncomment and add phone number to test:
    // await initiateWalmartSupportCall('+1234567890');
  })();
}

module.exports = {
  getScenarios,
  getScenarioDetails,
  initiateDoctorAppointmentCall,
  initiateWalmartSupportCall
};



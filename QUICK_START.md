# Quick Start Guide - Doctor Appointment Scenario

## Step-by-Step Instructions

### 1. Make sure your `.env` file is configured:

```env
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
OPENAI_API_KEY=your_openai_key
TO_PHONE_NUMBER=+923234856925
TRANSFER_PHONE_NUMBER=+923234856925
TWIML_URL=https://your-ngrok-url.ngrok-free.app/voice
```

### 2. Start the server (Terminal 1):

```bash
npm run server
```

You should see:
```
🚀 Server running on port 3000
```

### 3. Start ngrok (Terminal 2):

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`)

### 4. Update `.env` with ngrok URL:

```env
TWIML_URL=https://abc123.ngrok-free.app/voice
```

### 5. Run the doctor appointment scenario (Terminal 3):

**Option A: Using default (doctor-appointment is default)**
```bash
node index.js
```

**Option B: Explicitly specify doctor-appointment**
```bash
node index.js "" doctor-appointment
```

**Option C: Check status of existing call**
```bash
node index.js CA1234567890abcdef
```

## What Happens:

1. ✅ Call is initiated to `TO_PHONE_NUMBER`
2. ✅ System uses "doctor-appointment" scenario
3. ✅ AI acts as "Saif Ubaid"
4. ✅ Books appointment with cardiologist
5. ✅ Handles IVR menus automatically
6. ✅ Transfers if requested

## Doctor Appointment Scenario Details:

- **Name**: Saif Ubaid
- **Phone**: 923354541873
- **Preferred Time**: Thursday 2 PM
- **Doctor Type**: Cardiologist
- **Reason**: Chest pain

## Troubleshooting:

### Call not connecting?
- ✅ Check ngrok is running
- ✅ Verify `TWIML_URL` matches ngrok URL exactly
- ✅ Make sure server is running on port 3000

### AI not responding?
- ✅ Check `OPENAI_API_KEY` is set
- ✅ Verify server logs for errors

### IVR not working?
- ✅ Check server logs for IVR detection
- ✅ Verify hospital is speaking clearly



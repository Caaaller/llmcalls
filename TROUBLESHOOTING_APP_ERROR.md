# Troubleshooting "Application Error Has Occurred"

This error typically means Twilio can't reach your webhook or there's an error in your code.

## Quick Checklist

### 1. ✅ Is the server running?
```bash
npm run server
```
You should see: `🚀 Server running on port 3000`

### 2. ✅ Is ngrok running?
```bash
ngrok http 3000
```
Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`)

### 3. ✅ Is TWIML_URL correct in .env?
```env
TWIML_URL=https://your-ngrok-url.ngrok-free.app/voice
```
**Important**: Must include `/voice` at the end!

### 4. ✅ Check server logs
When you accept the call, you should see in your server terminal:
```
📞 Call received at /voice endpoint
Base URL: https://...
Call SID: CA...
Scenario ID: doctor-appointment
TwiML Response: <?xml version="1.0"...
```

### 5. ✅ Test the webhook manually
```bash
curl https://your-ngrok-url.ngrok-free.app/health
```
Should return: `{"status":"ok",...}`

## Common Issues

### Issue: Server not running
**Solution**: Start the server
```bash
npm run server
```

### Issue: ngrok not running or URL changed
**Solution**: 
1. Start ngrok: `ngrok http 3000`
2. Update `.env` with new URL
3. Restart server

### Issue: TWIML_URL missing /voice
**Solution**: Update `.env`:
```env
TWIML_URL=https://your-url.ngrok-free.app/voice
```

### Issue: Server error in logs
**Solution**: Check server terminal for error messages. Common errors:
- Missing environment variables
- OpenAI API key not set
- Scenario not found

### Issue: ngrok free tier limitations
**Solution**: ngrok free tier may have request limits. Try:
- Restart ngrok
- Use paid ngrok or alternative (localtunnel, etc.)

## Debug Steps

1. **Check server is running**
   ```bash
   curl http://localhost:3000/health
   ```

2. **Check ngrok is accessible**
   ```bash
   curl https://your-ngrok-url.ngrok-free.app/health
   ```

3. **Check Twilio webhook URL**
   - Go to Twilio Console → Phone Numbers
   - Check your number's webhook URL matches your ngrok URL

4. **Check server logs**
   - Look for error messages
   - Check if `/voice` endpoint is being called

5. **Test with curl**
   ```bash
   curl -X POST https://your-ngrok-url.ngrok-free.app/voice \
     -d "CallSid=test123" \
     -d "From=%2B1234567890" \
     -d "To=%2B0987654321"
   ```

## Still Not Working?

1. **Restart everything**:
   - Stop server (Ctrl+C)
   - Stop ngrok (Ctrl+C)
   - Start ngrok: `ngrok http 3000`
   - Update `.env` with new URL
   - Start server: `npm run server`

2. **Check Twilio Console**:
   - Go to Monitor → Logs → Calls
   - Check the error details for your call

3. **Verify environment variables**:
   ```bash
   node -e "require('dotenv').config(); console.log('TWIML_URL:', process.env.TWIML_URL)"
   ```

## Fixed Issues

✅ Added comprehensive error handling
✅ Better error logging
✅ Always returns valid TwiML even on errors
✅ Fixed syntax errors



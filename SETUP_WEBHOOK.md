# How to Get Your TWIML_URL

The `TWIML_URL` is the public webhook URL that Twilio calls when someone answers your phone call. Since your server runs locally, you need to expose it to the internet.

## Step-by-Step Guide

### Option 1: Using ngrok (Recommended for Testing)

#### Step 1: Install ngrok

**On macOS:**
```bash
brew install ngrok
```

**Or download from:** https://ngrok.com/download

#### Step 2: Start Your Server

In Terminal 1:
```bash
npm run server
```

You should see:
```
🚀 Twilio webhook server running on port 3000
📞 Webhook URL: http://localhost:3000/voice
```

#### Step 3: Start ngrok

In Terminal 2 (new terminal window):
```bash
ngrok http 3000
```

You'll see something like:
```
Forwarding   https://abc123def456.ngrok-free.app -> http://localhost:3000
```

#### Step 4: Copy the HTTPS URL

Copy the **HTTPS URL** (the one starting with `https://`). It will look like:
```
https://abc123def456.ngrok-free.app
```

#### Step 5: Update Your .env File

Add `/voice` to the end of the ngrok URL:

```env
TWIML_URL=https://abc123def456.ngrok-free.app/voice
```

**Important:** Make sure to include `/voice` at the end!

#### Step 6: Restart Your Server

Go back to Terminal 1 and restart your server (Ctrl+C, then `npm run server` again).

### Option 2: Using Other Tunneling Services

- **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:3000`
- **LocalTunnel**: `npx localtunnel --port 3000`
- **Serveo**: `ssh -R 80:localhost:3000 serveo.net`

### Option 3: Deploy to a Server

Deploy `server.js` to:
- Heroku
- Railway
- Render
- DigitalOcean
- AWS
- Any Node.js hosting service

Then use your deployed URL:
```env
TWIML_URL=https://your-app.herokuapp.com/voice
```

## Testing Your Webhook

Once you have your `TWIML_URL` set up:

1. Test the webhook directly in your browser:
   ```
   https://your-ngrok-url.ngrok.io/health
   ```
   Should return: `{"status":"ok","message":"Server is running"}`

2. Test the voice endpoint (will show TwiML XML):
   ```
   https://your-ngrok-url.ngrok.io/voice
   ```

3. Make a call:
   ```bash
   npm start
   ```

## Troubleshooting

### "Application Error" Message

- ✅ Make sure ngrok is running
- ✅ Check that `TWIML_URL` in `.env` matches your ngrok URL exactly
- ✅ Ensure `/voice` is at the end of the URL
- ✅ Verify your server is running on port 3000
- ✅ Check ngrok web interface: http://127.0.0.1:4040 (shows all requests)

### ngrok URL Changes Every Time

**Free ngrok:** URL changes each time you restart ngrok.

**Solution:** 
- Use ngrok's static domain (paid feature)
- Or update `.env` each time you restart ngrok
- Or deploy to a permanent server

### Server Not Receiving Requests

1. Check ngrok web interface: http://127.0.0.1:4040
2. Look for incoming requests from Twilio
3. Check server logs for errors
4. Verify `TWIML_URL` in `.env` is correct



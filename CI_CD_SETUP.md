# CI/CD Setup Complete ✅

I've set up automated CI/CD that deploys your demo whenever code is merged to `master`.

## What Was Created

### 1. GitHub Actions Workflows (Railway Only)

**`.github/workflows/ci.yml`**
- Runs on every pull request and push
- Validates code quality (builds, type checks)
- Ensures code is ready before merge

**`.github/workflows/deploy.yml`** (Railway)
- Automatically deploys when code is merged to `master`
- Builds TypeScript backend
- Builds React frontend
- Deploys to Railway

### 2. Server Updates

Updated `src/server.ts` to:
- ✅ Serve React frontend in production
- ✅ Handle CORS for production URLs
- ✅ Support both development and production modes
- ✅ Serve static files correctly

### 3. Documentation

- `DEPLOYMENT.md` - Complete deployment guide
- `.github/workflows/README.md` - Workflow documentation

## Next Steps

### Step 1: Configure Railway (single platform)

**Railway** (current and only deployment target)
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Create new project → Deploy from GitHub repo
4. Select this repository

### Step 2: Configure Environment Variables

Add these in your platform's dashboard:
```
PORT=3000
NODE_ENV=production
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
OPENAI_API_KEY=your_openai_api_key
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
TRANSFER_PHONE_NUMBER=your_transfer_phone_number
USER_PHONE_NUMBER=your_user_phone_number
USER_EMAIL=your_email
BASE_URL=https://your-app.railway.app (or render.com)
TWIML_URL=https://your-app.railway.app/voice
FRONTEND_URL=https://your-app.railway.app (same as BASE_URL)
```

### Step 3: Add GitHub Secrets

**Railway:**
1. Get Railway token: Railway Dashboard → Account Settings → Tokens
2. Get Service ID: Railway Dashboard → Your Service → Settings
3. Go to GitHub → Your Repo → Settings → Secrets → Actions
4. Add:
   - `RAILWAY_TOKEN` = Your Railway API token
   - `RAILWAY_SERVICE_ID` = Your Railway service ID


### Step 4: Test Deployment

1. Make a small change (e.g., update a comment)
2. Commit and push to `master`
3. Check GitHub Actions tab - you should see the workflow running
4. Check your platform dashboard - deployment should start automatically
5. Visit your deployed URL to verify it works

## How It Works

1. **Developer merges code to `master`**
2. **GitHub Actions triggers** automatically
3. **Workflow runs**:
   - Checks out code
   - Installs dependencies
   - Builds TypeScript → `dist/`
   - Builds React frontend → `frontend/build/`
   - Type checks code
4. **Deploys** to Railway
5. **Demo is live** 🎉

## Manual Deployment

You can also trigger deployment manually:
- Go to GitHub → Actions tab
- Select "Deploy Demo" workflow
- Click "Run workflow" → "Run workflow"

## Troubleshooting

**Workflow fails?**
- Check GitHub Actions logs
- Verify secrets are set correctly
- Ensure environment variables are configured

**Deployment fails?**
- Check Railway logs
- Verify build commands are correct
- Ensure all dependencies are in `package.json`

**App doesn't start?**
- Check environment variables in Railway
- Verify MongoDB connection
- Check Railway logs for errors

## Files Changed

- ✅ `.github/workflows/ci.yml` - CI workflow
- ✅ `.github/workflows/deploy.yml` - Railway deployment
- ✅ `src/server.ts` - Updated for production serving
- ✅ `DEPLOYMENT.md` - Railway deployment guide

## Need Help?

See `DEPLOYMENT.md` and `RAILWAY_TROUBLESHOOTING.md` for detailed Railway instructions.


# Railway GitHub OAuth Login Troubleshooting

If you're getting "Error authenticating with GitHub" or "Problem completing OAuth login", try these solutions:

## Quick Fixes

### 1. Clear Browser Cache & Cookies
- Clear cookies for `railway.app`
- Try incognito/private browsing mode
- Use a different browser

### 2. Check GitHub Permissions
- Go to GitHub → Settings → Applications → Authorized OAuth Apps
- Revoke Railway access
- Try logging in again

### 3. Use Email/Password Instead
- Railway allows email signup
- Sign up with email first
- Connect GitHub later from settings

### 4. Try Different Network
- Switch WiFi networks
- Use mobile hotspot
- Check if corporate firewall is blocking

## Alternative: Use Railway CLI

Instead of web OAuth, use the CLI:

### Step 1: Install Railway CLI

**macOS/Linux:**
```bash
curl -fsSL https://railway.app/install.sh | sh
```

**Windows:**
```powershell
iwr https://railway.app/install.ps1 | iex
```

**Or with npm:**
```bash
npm install -g @railway/cli
```

### Step 2: Login via CLI

```bash
railway login
```

This will open a browser window for authentication. If that fails:

```bash
railway login --browserless
```

This gives you a token to paste manually.

### Step 3: Get Your Token

After CLI login, get your token:

```bash
railway whoami
```

Or get token directly:
```bash
railway token
```

### Step 4: Use Token in GitHub Actions

1. Copy the token from CLI
2. Go to GitHub → Your Repo → Settings → Secrets → Actions
3. Add secret: `RAILWAY_TOKEN` = your token

## Alternative: Manual Setup Without OAuth

### Option 1: Create Project Manually

1. **Sign up with Email**
   - Go to [railway.app](https://railway.app)
   - Click "Sign Up"
   - Use email instead of GitHub

2. **Create Project**
   - Click "New Project"
   - Select "Empty Project"

3. **Connect GitHub Repo**
   - Click "New" → "GitHub Repo"
   - Authorize Railway (this might work even if web OAuth doesn't)
   - Select your repository

4. **Get Service ID**
   - Go to your service → Settings
   - Copy the Service ID

5. **Get API Token**
   - Go to Account Settings → Tokens
   - Create new token
   - Copy token

6. **Add GitHub Secrets**
   - `RAILWAY_TOKEN`: Your API token
   - `RAILWAY_SERVICE_ID`: Your service ID

### Option 2: Use Railway API Directly

If OAuth completely fails, you can use Railway's REST API:

1. **Get API Token** (via CLI or email signup)
2. **Create project via API**
3. **Deploy via API**

## GitHub Actions Workaround

If Railway OAuth fails, you can still deploy using the CLI method in GitHub Actions:

Update `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Railway

on:
  push:
    branches:
      - master
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Login to Railway
        run: railway login --token ${{ secrets.RAILWAY_TOKEN }}

      - name: Deploy
        run: railway up
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

## Still Having Issues?

### Check Railway Status
- Visit [status.railway.app](https://status.railway.app)
- Check if Railway is experiencing issues

### Contact Railway Support
- Email: support@railway.app
- Discord: [railway.app/discord](https://discord.gg/railway)
- They're usually very responsive

### If Problems Persist
- Confirm your environment variables and GitHub secrets
- Try the CLI login method again
- Contact Railway support if the issue continues


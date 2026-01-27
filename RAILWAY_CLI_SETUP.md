# Railway Setup via CLI (OAuth Workaround)

If Railway GitHub OAuth isn't working, use the CLI method instead.

## Step 1: Install Railway CLI

**macOS/Linux:**
```bash
curl -fsSL https://railway.app/install.sh | sh
```

**Or with npm:**
```bash
npm install -g @railway/cli
```

**Windows:**
```powershell
iwr https://railway.app/install.ps1 | iex
```

## Step 2: Login via CLI

```bash
railway login
```

This will open a browser. If that fails:

```bash
railway login --browserless
```

Copy the token shown and paste it when prompted.

## Step 3: Create Project

```bash
# Create new project
railway init

# Or link to existing project
railway link
```

## Step 4: Get Your Credentials

### Get Service ID:
```bash
railway status
# Look for "Service ID" in the output
```

Or:
```bash
railway service
```

### Get API Token:
```bash
railway whoami
railway token
```

Or create one:
```bash
railway token create
```

## Step 5: Add to GitHub Secrets

1. Go to GitHub → Your Repo → Settings → Secrets → Actions
2. Add:
   - `RAILWAY_TOKEN`: Your Railway API token
   - `RAILWAY_SERVICE_ID`: Your service ID (found via `railway status`)

## Step 6: Test Deployment

The workflow will now use CLI instead of OAuth, which is more reliable.

## Alternative: Email Signup

If CLI also fails:

1. Go to [railway.app](https://railway.app)
2. Click "Sign Up"
3. Choose "Sign up with Email"
4. Create account
5. Get token from Account Settings → Tokens
6. Use that token in GitHub Secrets


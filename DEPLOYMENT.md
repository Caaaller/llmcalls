# Deployment Guide

This project uses GitHub Actions for CI/CD. When code is merged to `master` (or `main`), it automatically builds and deploys the demo.

## CI/CD Setup (Railway Only)

### GitHub Actions Workflows

1. **CI Workflow** (`.github/workflows/ci.yml`)
   - Runs on pull requests and pushes
   - Builds TypeScript
   - Type checks the code
   - Builds frontend
   - Ensures code quality before merge

2. **Deploy Workflow** (`.github/workflows/deploy.yml`)
   - Runs on merge to `master`/`main`
   - Builds the application
   - Deploys to Railway

## Deployment on Railway

Railway is the single deployment platform used for this project.

**Setup Steps:**

1. **Create Railway Account**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub or email

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose this repository

3. **Configure Environment Variables**
   In the Railway dashboard, add these variables:
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
   BASE_URL=https://your-app.railway.app
   TWIML_URL=https://your-app.railway.app/voice
   ```

4. **Get Railway Token**
   - Go to Railway dashboard → Account Settings → Tokens
   - Create a new token
   - Copy the token

5. **Add GitHub Secrets**
   - Go to your GitHub repo → Settings → Secrets and variables → Actions
   - Add these secrets:
     - `RAILWAY_TOKEN`: Your Railway API token
     - `RAILWAY_SERVICE_ID`: Your Railway service ID (found in service settings)

6. **Enable Auto-Deploy**
   - Railway will automatically deploy on push to master using the `deploy.yml` workflow

## Frontend Deployment

The frontend needs to be served. Options:

1. **Serve from Backend** (Recommended)
   - Add static file serving in `server.ts`:
   ```typescript
   app.use(express.static(path.join(__dirname, '../frontend/build')));
   app.get('*', (req, res) => {
     res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
   });
   ```

2. **Separate Frontend Deployment**
- (Not used in this project; backend serves the built React app)

## Environment Variables

Make sure all required environment variables are set in your deployment platform:

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Set to `production`
- `TWILIO_ACCOUNT_SID`: Twilio account SID
- `TWILIO_AUTH_TOKEN`: Twilio auth token
- `TWILIO_PHONE_NUMBER`: Your Twilio phone number
- `OPENAI_API_KEY`: OpenAI API key
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: Secret for JWT tokens
- `TRANSFER_PHONE_NUMBER`: Phone number for transfers
- `USER_PHONE_NUMBER`: User's phone number
- `USER_EMAIL`: User's email
- `BASE_URL`: Your deployed app URL
- `TWIML_URL`: Full URL to `/voice` endpoint

## Testing Deployment

1. Merge a small change to `master`
2. Check GitHub Actions tab for workflow status
3. Verify deployment in your platform dashboard
4. Test the deployed application

## Troubleshooting

- **Build fails**: Check GitHub Actions logs
- **Deployment fails**: Verify secrets are set correctly
- **App doesn't start**: Check environment variables
- **Frontend not loading**: Verify static file serving is configured


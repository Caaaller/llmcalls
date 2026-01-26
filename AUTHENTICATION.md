# Authentication System

The application now includes a complete authentication system with signup, login, and logout functionality.

## Features

- ✅ User signup with email, password, and name
- ✅ User login with email and password
- ✅ JWT token-based authentication
- ✅ Protected API routes
- ✅ Persistent login sessions (7-day token expiration)
- ✅ Secure password hashing with bcrypt

## Setup

### 1. Environment Variables

Add the following to your `.env` file:

```env
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```

**Important:** Use a strong, random secret key in production. You can generate one using:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 2. MongoDB

The authentication system uses MongoDB to store user accounts. Make sure MongoDB is running and `MONGODB_URI` is set in your `.env` file.

## API Endpoints

### Public Endpoints (No Authentication Required)

#### Sign Up
```
POST /api/auth/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe"
}
```

Response:
```json
{
  "success": true,
  "message": "User created successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

#### Login
```
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

Response:
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

### Protected Endpoints (Authentication Required)

All other API endpoints require authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer <your-token>
```

#### Get Current User
```
GET /api/auth/me
Authorization: Bearer <token>
```

#### Logout
```
POST /api/auth/logout
Authorization: Bearer <token>
```

## Protected Routes

The following routes now require authentication:

- `GET /api/config` - Get transfer configuration
- `GET /api/prompt` - Get transfer prompt
- `POST /api/settings` - Save settings
- `POST /api/calls/initiate` - Initiate a call
- `GET /api/calls/history` - Get call history
- `GET /api/calls/:callSid` - Get call details

## Frontend Usage

### Login Flow

1. When the app loads, it checks for a stored token in `localStorage`
2. If a token exists, it validates it with `/api/auth/me`
3. If valid, the user is logged in automatically
4. If invalid or missing, the login screen is shown

### Sign Up Flow

1. Click "Sign Up" on the login screen
2. Enter name, email, and password (minimum 6 characters)
3. Submit the form
4. On success, the token is stored and the user is logged in

### Logout

Click the "Logout" button in the header to log out. This clears the stored token and redirects to the login screen.

## Security Features

- **Password Hashing**: Passwords are hashed using bcrypt before storage
- **JWT Tokens**: Secure token-based authentication
- **Token Expiration**: Tokens expire after 7 days
- **Protected Routes**: All sensitive endpoints require authentication
- **Password Validation**: Minimum 6 characters required
- **Email Validation**: Email format is validated

## User Model

The User model stores:
- `email` (unique, required)
- `password` (hashed, required, min 6 characters)
- `name` (required)
- `createdAt` (auto-generated)
- `updatedAt` (auto-generated)

## Troubleshooting

### "No token provided" Error
- Make sure you're logged in
- Check that the token is stored in `localStorage`
- Try logging out and logging back in

### "Invalid token" Error
- Your token may have expired (7 days)
- Log out and log back in to get a new token

### "User not found" Error
- The user account may have been deleted
- Try creating a new account

### MongoDB Connection Issues
- Make sure MongoDB is running
- Check that `MONGODB_URI` is set correctly in `.env`
- Verify MongoDB connection in server logs

## Next Steps

For production deployment, consider:

1. **Password Strength**: Add password strength requirements
2. **Email Verification**: Add email verification flow
3. **Password Reset**: Add password reset functionality
4. **Rate Limiting**: Add rate limiting to prevent brute force attacks
5. **Refresh Tokens**: Implement refresh tokens for better security
6. **Session Management**: Add session management and device tracking



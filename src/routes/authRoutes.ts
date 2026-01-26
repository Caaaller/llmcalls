/**
 * Authentication Routes
 * Signup, login, logout endpoints
 */

import express, { Request, Response } from 'express';
import User from '../models/User';
import { generateToken, authenticate, AuthRequest } from '../middleware/auth';

const router = express.Router();

/**
 * Sign up a new user
 * POST /api/auth/signup
 */
router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password || !name) {
      res.status(400).json({
        success: false,
        error: 'Please provide email, password, and name'
      });
      return;
    }
    
    if (password.length < 6) {
      res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
      return;
    }
    
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
      return;
    }
    
    const user = new User({
      email: email.toLowerCase(),
      password,
      name
    });
    
    await user.save();
    
    const token = generateToken(user._id.toString());
    
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Error creating user';
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

/**
 * Login user
 * POST /api/auth/login
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: 'Please provide email and password'
      });
      return;
    }
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
      return;
    }
    
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
      return;
    }
    
    const token = generateToken(user._id.toString());
    
    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Error logging in';
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

/**
 * Get current user (requires authentication)
 * GET /api/auth/me
 */
router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'User not found'
      });
      return;
    }

    res.json({
      success: true,
      user: {
        id: req.user._id,
        email: req.user.email,
        name: req.user.name
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Error fetching user';
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

/**
 * Logout
 * POST /api/auth/logout
 */
router.post('/logout', authenticate, async (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    message: 'Logout successful'
  });
});

export default router;


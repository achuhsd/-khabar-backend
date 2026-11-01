const express = require('express')
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const protect = require('../middleware/authMiddleware')

const router = express.Router()

function generateToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' })
}

// Shape the user object consistently everywhere it's sent to the frontend,
// so Home/Profile always have the real fields to display (previously this
// was missing totalArticlesRead/quizAvg/createdAt, which is why the UI was
// showing old hardcoded demo numbers instead).
function toClientUser(user) {
  return {
    id: user._id,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    interests: user.interests,
    streak: user.streak,
    tokens: user.tokens,
    totalArticlesRead: user.totalArticlesRead,
    quizAvg: user.quizAvg,
    createdAt: user.createdAt,
  }
}

// @route   POST /api/auth/register
// @desc    Create a new user account
router.post('/register', async (req, res) => {
  try {
    const { fullName, username, email, password } = req.body

    if (!fullName || !username || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' })
    }
    if (password.length < 6) {
  return res.status(400).json({ message: 'Password must be at least 6 characters' })
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  return res.status(400).json({ message: 'Please enter a valid email address' })
}

    const existingEmail = await User.findOne({ email: email.toLowerCase() })
    if (existingEmail) {
      return res.status(409).json({ message: 'An account with this email already exists' })
    }

    const existingUsername = await User.findOne({ username })
    if (existingUsername) {
      return res.status(409).json({ message: 'This username is already taken' })
    }

    const user = await User.create({ fullName, username, email, password })
    const token = generateToken(user._id)

    res.status(201).json({ token, user: toClientUser(user) })
  } catch (error) {
    res.status(500).json({ message: 'Registration failed', error: error.message })
  }
})

// @route   POST /api/auth/login
// @desc    Log in an existing user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' })
    }

    const user = await User.findOne({ email: email.toLowerCase() })
    if (!user) {
      return res.status(404).json({ message: 'No account found with this email' })
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect password' })
    }

    const token = generateToken(user._id)

    res.json({ token, user: toClientUser(user) })
  } catch (error) {
    res.status(500).json({ message: 'Login failed', error: error.message })
  }
})

// @route   PATCH /api/auth/interests
// @desc    Save the interests selected during onboarding (requires login)
router.patch('/interests', protect, async (req, res) => {
  try {
    const { interests } = req.body

    if (!Array.isArray(interests) || interests.length < 3) {
      return res.status(400).json({ message: 'Please select at least 3 interests' })
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { interests },
      { new: true }
    )

    res.json({ user: toClientUser(user) })
  } catch (error) {
    res.status(500).json({ message: 'Could not save interests', error: error.message })
  }
})

// @route   GET /api/auth/me
// @desc    Get the logged-in user's own profile (requires login)
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    res.json({ user: toClientUser(user) })
  } catch (error) {
    res.status(500).json({ message: 'Could not fetch profile', error: error.message })
  }
})

module.exports = router

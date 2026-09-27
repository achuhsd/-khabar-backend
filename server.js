const dns = require('dns')
dns.setDefaultResultOrder('ipv4first')
dns.setServers(['8.8.8.8', '8.8.4.4'])

require('dotenv').config()
const express = require('express')
const cors = require('cors')
const connectDB = require('./config/db')
const authRoutes = require('./routes/auth')
const articleRoutes = require('./routes/articles')
const newsRoutes = require('./routes/news')
const chatRoutes = require('./routes/chat')
const { scheduleNewsRefresh } = require('./services/newsCache')

const app = express()

// Connect to MongoDB
connectDB()

// Middleware
app.use(cors())
app.use(express.json())

// Health check route - visit http://localhost:5000/ to confirm server is running
app.get('/', (req, res) => {
  res.json({ message: 'KHABAR backend is running ⚡' })
})

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/articles', articleRoutes)
app.use('/api/news', newsRoutes)
app.use('/api/chat', chatRoutes)

// Catch-all error handler
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ message: 'Something went wrong on the server' })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`🚀 KHABAR backend running on http://localhost:${PORT}`)

  const refreshMinutes = parseInt(process.env.NEWS_REFRESH_INTERVAL_MINUTES, 10) || 60
  scheduleNewsRefresh(refreshMinutes).catch((err) => {
    console.error('❌ Failed to schedule news refresh:', err.message)
  })
})

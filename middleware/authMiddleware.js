const jwt = require('jsonwebtoken')

function protect(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized, no token provided' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    // decoded contains { id: user._id } - attach it to the request
    req.userId = decoded.id
    next()
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized, token failed or expired' })
  }
}

module.exports = protect

const mongoose = require('mongoose')

// A single tiny document that just remembers when the news cache last ran.
// This is what lets us skip an unnecessary GNews/Gemini burn every time the
// dev server restarts (which happens constantly with nodemon).
const cacheMetaSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  lastRefreshedAt: { type: Date, default: null },
})

module.exports = mongoose.model('CacheMeta', cacheMetaSchema)

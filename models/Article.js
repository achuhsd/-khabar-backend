const mongoose = require('mongoose')

const articleSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
      // e.g. "Politics", "Business", "Sports", "Technology"
    },
    summary: {
      type: String,
      default: '',
    },
    content: {
      type: String,
      default: '',
    },
    image: {
      type: String,
      default: '',
    },
    source: {
      type: String,
      default: 'KHABAR Desk',
    },
    // The original article's URL - used as a unique fingerprint so the
    // hourly cache refresh never creates duplicate entries for the same story
    url: {
      type: String,
      required: true,
      unique: true,
    },
    // "Explain Like a Friend" breakdown - generated once by Gemini when the
    // article is first cached, then reused by every reader after that
    explainLikeFriend: {
      whatHappened: { type: String, default: '' },
      whyItHappened: { type: String, default: '' },
      whatItMeans: { type: String, default: '' },
    },
    // True only when the explanation above came from a real, successful
    // Gemini call - false means it's still the generic fallback text and
    // should be retried on a future cache cycle (see services/newsCache.js)
    explainGenerated: {
      type: Boolean,
      default: false,
    },
    publishedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Article', articleSchema)

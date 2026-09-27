const express = require('express')
const router = express.Router()
const Article = require('../models/Article')

// Maps every KHABAR interest category to the canonical label actually
// stored in MongoDB (several categories share the same underlying GNews
// topic - see services/newsCache.js for the full topic list).
const CATEGORY_TO_STORED_LABEL = {
  politics: 'Politics',
  law: 'Politics',
  business: 'Business',
  sports: 'Sports',
  technology: 'Technology',
  gaming: 'Technology',
  entertainment: 'Entertainment',
  world: 'World',
  education: 'General',
  agriculture: 'General',
  general: 'General',
  health: 'Health',
  science: 'Science',
}

// Colors keyed by the CANONICAL stored label (not the requested category),
// since a single response can now contain articles from several different
// requested categories that all map to the same stored label.
const CATEGORY_COLORS = {
  Politics: '#FF6B47',
  Business: '#FFD166',
  Sports: '#FF6B47',
  Technology: '#1ECFAA',
  Entertainment: '#FFD166',
  World: '#1ECFAA',
  General: '#1ECFAA',
  Health: '#1ECFAA',
  Science: '#1ECFAA',
}

// @route   GET /api/news?category=politics,business&max=20
// @desc    Serve cached news from MongoDB. Accepts one or more comma-
//          separated categories. "General" is always included as a
//          fallback so the pool never feels too thin even if a specific
//          category has few cached articles yet.
router.get('/', async (req, res) => {
  try {
    const categoryParam = (req.query.category || 'general').toLowerCase()
    const max = parseInt(req.query.max, 10) || 20

    const requestedTokens = categoryParam.split(',').map((c) => c.trim()).filter(Boolean)
    const storedLabels = new Set(['General']) // always include General as a baseline
    requestedTokens.forEach((token) => {
      storedLabels.add(CATEGORY_TO_STORED_LABEL[token] || 'General')
    })

    const docs = await Article.find({ category: { $in: [...storedLabels] } })
      .sort({ publishedAt: -1 })
      .limit(max)

    const articles = docs.map((doc) => ({
      id: doc._id,
      category: doc.category,
      categoryColor: CATEGORY_COLORS[doc.category] || '#1ECFAA',
      title: doc.title,
      summary: doc.summary,
      content: doc.content,
      image: doc.image,
      source: doc.source,
      publishedAt: doc.publishedAt,
      url: doc.url,
      explainLikeFriend: doc.explainLikeFriend,
    }))

    res.json({ articles })
  } catch (error) {
    res.status(500).json({ message: 'Could not fetch news', error: error.message })
  }
})

module.exports = router

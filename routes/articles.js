const mongoose = require('mongoose')
const express = require('express')
const Article = require('../models/Article')

const router = express.Router()

// @route   GET /api/articles
// @desc    Get all articles, optionally filtered by ?category=Politics
router.get('/', async (req, res) => {
  try {
    const filter = {}
    if (req.query.category) {
      filter.category = req.query.category
    }

    const articles = await Article.find(filter).sort({ publishedAt: -1 })
    res.json({ articles })
  } catch (error) {
    res.status(500).json({ message: 'Could not fetch articles', error: error.message })
  }
})

// @route   GET /api/articles/:id
// @desc    Get a single article by its id
router.get('/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: 'Invalid article ID' })
  }
  try {
    const article = await Article.findById(req.params.id)
    if (!article) {
      return res.status(404).json({ message: 'Article not found' })
    }
    res.json({ article })
  } catch (error) {
    res.status(500).json({ message: 'Could not fetch article', error: error.message })
  }
})

module.exports = router
const express = require('express')
const router = express.Router()

// Using the "latest" alias instead of a pinned version number, so this
// automatically points to Google's current recommended fast model even
// after older Gemini versions get deprecated.
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent'

const SYSTEM_INSTRUCTION = `You are "Khabar Mitra" (News Friend), the friendly AI chat assistant inside
the KHABAR Indian news app. Your personality:
- Talk in casual, warm Hinglish (a natural mix of Hindi and English), like a
  smart friend explaining news over chai — not a formal news anchor.
- Keep replies short and easy to read: 2 to 5 sentences unless the user
  clearly asks for a longer breakdown.
- If an article is provided as context, ground your answer in it. If the
  question goes beyond the article, answer from general knowledge but say so.
- Never invent fake facts, numbers, or quotes. If you are unsure, say so
  honestly instead of guessing.
- You may use light emoji, but do not overdo it.`

// @route   POST /api/chat
// @desc    Send a message to Khabar Mitra (Gemini) and get a reply
router.post('/', async (req, res) => {
  try {
    const { message, article, history } = req.body

    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'A message is required' })
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ message: 'GEMINI_API_KEY is missing from .env' })
    }

    let contextText = ''
    if (article) {
      contextText = `\n\nThe user is currently reading this news article, use it as context when relevant:\nTitle: ${article.title}\nSummary: ${article.summary || article.content || ''}`
    }

    // Include a short slice of recent chat history so the AI can handle
    // natural follow-up questions like "what about last year?"
    const contents = []
    if (Array.isArray(history)) {
      history.slice(-6).forEach((h) => {
        contents.push({
          role: h.sender === 'user' ? 'user' : 'model',
          parts: [{ text: h.text }],
        })
      })
    }
    contents.push({ role: 'user', parts: [{ text: message }] })

    const body = {
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION + contextText }] },
      contents,
    }

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    })

    const data = await response.json()

    if (!response.ok) {
      return res.status(response.status).json({
        message: data.error?.message || 'Gemini API returned an error',
      })
    }

    const reply =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ||
      'Sorry yaar, samajh nahi paya. Dobara try karo?'

    res.json({ reply })
  } catch (error) {
    res.status(500).json({ message: 'Chat request failed', error: error.message })
  }
})

module.exports = router

// This service generates the "Explain Like a Friend" breakdown using Gemini.
// It is called from services/newsCache.js - once when a brand-new article is
// first discovered, and again later by the "healing" pass for any older
// article whose explanation never successfully generated the first time.
//
// It always returns { explainLikeFriend, generated } - `generated` tells the
// caller whether this was a REAL Gemini result (true) or the Hinglish
// fallback text (false), so the caller can decide whether to retry later.

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent'

const PROMPT_INSTRUCTION = `You are writing a short, friendly Hinglish (Hindi-English mix) explanation of a
news article for the KHABAR app. Given the article's title and description, respond
with ONLY a JSON object (no markdown, no code fences, no extra text) in exactly this shape:
{"whatHappened": "...", "whyItHappened": "...", "whatItMeans": "..."}
Each value should be 1-2 short sentences, casual Hinglish, easy for a student to
understand quickly.`

// Fallback text is now in Hinglish too, so the app's voice stays consistent
// even when Gemini couldn't be reached for a particular article.
function placeholderExplanation(article) {
  return {
    whatHappened: article.description || article.title,
    whyItHappened:
      'Poori background is article ke original report mein hai — neeche "Continue reading" dabakar padh sakte ho.',
    whatItMeans:
      'Abhi AI se yeh part generate nahi ho paya, thodi der mein automatically dobara try hoga. Tab tak upar wala summary padh lo.',
  }
}

async function generateExplainLikeFriend(article) {
  if (!process.env.GEMINI_API_KEY) {
    return { explainLikeFriend: placeholderExplanation(article), generated: false }
  }

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: PROMPT_INSTRUCTION }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: `Title: ${article.title}\nDescription: ${article.description || ''}` }],
          },
        ],
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.warn('⚠️  Gemini explanation call failed:', data.error?.message)
      return { explainLikeFriend: placeholderExplanation(article), generated: false }
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''
    const cleaned = text.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(cleaned)

    if (!parsed.whatHappened || !parsed.whyItHappened || !parsed.whatItMeans) {
      throw new Error('Gemini returned incomplete JSON')
    }

    return { explainLikeFriend: parsed, generated: true }
  } catch (err) {
    console.warn('⚠️  Could not generate AI explanation, using Hinglish fallback:', err.message)
    return { explainLikeFriend: placeholderExplanation(article), generated: false }
  }
}

module.exports = { generateExplainLikeFriend }

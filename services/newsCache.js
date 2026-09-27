// This is the ONLY place in the whole backend that ever calls GNews.
// Every user request is served from MongoDB (see routes/news.js) - GNews is
// called on a timer here, in the background.
//
// IMPORTANT FIX: previously, EVERY server restart (including nodemon
// auto-restarting on every file save during development) triggered an
// immediate GNews + Gemini refresh. With many restarts during active
// development, this burns through GNews's daily quota very fast, which is
// why the news pool can shrink to just a couple of articles. Now, a small
// "last refreshed at" record is kept in MongoDB (see models/CacheMeta.js)
// so a restart only re-triggers a refresh if enough time has genuinely
// passed - not just because the process restarted.

const Article = require('../models/Article')
const CacheMeta = require('../models/CacheMeta')
const { generateExplainLikeFriend } = require('./explainService')

const GNEWS_BASE = 'https://gnews.io/api/v4/top-headlines'
const CACHE_META_KEY = 'newsCache'

// Wait this long between Gemini calls so we never burst past the free-tier
// per-minute rate limit, no matter how many new articles show up at once.
const GEMINI_DELAY_MS = 4000

// How many previously-failed articles to retry healing per cycle.
const HEAL_BATCH_SIZE = 15

// One GNews API call per topic below covers ALL 12 of KHABAR's interest
// categories (see CATEGORY_TO_STORED_LABEL in routes/news.js).
const GNEWS_TOPICS = [
  { topic: 'nation', label: 'Politics' },
  { topic: 'business', label: 'Business' },
  { topic: 'sports', label: 'Sports' },
  { topic: 'technology', label: 'Technology' },
  { topic: 'entertainment', label: 'Entertainment' },
  { topic: 'world', label: 'World' },
  { topic: 'general', label: 'General' },
  { topic: 'health', label: 'Health' },
  { topic: 'science', label: 'Science' },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchTopicFromGNews(topic) {
  const url = `${GNEWS_BASE}?category=${topic}&lang=en&country=in&max=10&apikey=${process.env.GNEWS_API_KEY}`
  const response = await fetch(url)
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.errors?.[0] || `GNews error for topic "${topic}"`)
  }
  return data.articles || []
}

async function healPlaceholderExplanations() {
  const broken = await Article.find({ explainGenerated: false }).limit(HEAL_BATCH_SIZE)
  if (broken.length === 0) return

  console.log(`🩹 Attempting to heal ${broken.length} article(s) with missing AI explanations...`)

  for (const doc of broken) {
    const result = await generateExplainLikeFriend({ title: doc.title, description: doc.summary })
    if (result.generated) {
      doc.explainLikeFriend = result.explainLikeFriend
      doc.explainGenerated = true
      await doc.save()
      console.log(`   ✅ Healed: ${doc.title.slice(0, 60)}...`)
    }
    await sleep(GEMINI_DELAY_MS)
  }
}

async function refreshNewsCache() {
  if (!process.env.GNEWS_API_KEY) {
    console.warn('⚠️  Skipping news refresh - GNEWS_API_KEY missing from .env')
    return
  }

  console.log('🔄 Refreshing news cache from GNews...')

  await healPlaceholderExplanations()

  let totalNew = 0
  let totalAlreadyCached = 0

  for (const { topic, label } of GNEWS_TOPICS) {
    try {
      const rawArticles = await fetchTopicFromGNews(topic)

      for (const raw of rawArticles) {
        if (!raw.url || !raw.title) continue

        const existing = await Article.findOne({ url: raw.url })
        if (existing) {
          totalAlreadyCached++
          continue
        }

        const result = await generateExplainLikeFriend({
          title: raw.title,
          description: raw.description,
        })

        await Article.create({
          title: raw.title,
          category: label,
          summary: raw.description || '',
          content: raw.content || raw.description || '',
          image: raw.image || '',
          source: raw.source?.name || 'Unknown Source',
          url: raw.url,
          publishedAt: raw.publishedAt || new Date(),
          explainLikeFriend: result.explainLikeFriend,
          explainGenerated: result.generated,
        })
        totalNew++

        await sleep(GEMINI_DELAY_MS)
      }
    } catch (err) {
      console.warn(`⚠️  Could not refresh topic "${topic}": ${err.message}`)
    }
  }

  await CacheMeta.findOneAndUpdate(
    { key: CACHE_META_KEY },
    { lastRefreshedAt: new Date() },
    { upsert: true }
  )

  console.log(`✅ News cache refresh done — ${totalNew} new article(s), ${totalAlreadyCached} already cached`)
}

async function scheduleNewsRefresh(intervalMinutes) {
  const intervalMs = intervalMinutes * 60 * 1000

  let meta
  try {
    meta = await CacheMeta.findOne({ key: CACHE_META_KEY })
  } catch (err) {
    console.warn('⚠️  Could not read cache metadata, will refresh immediately to be safe:', err.message)
  }

  const lastRun = meta?.lastRefreshedAt?.getTime() || 0
  const elapsed = Date.now() - lastRun
  const delay = elapsed >= intervalMs ? 0 : intervalMs - elapsed

  if (delay === 0) {
    console.log('🕒 News cache is stale (or has never run) — refreshing now...')
  } else {
    console.log(`🕒 News cache was refreshed recently — next refresh in ${Math.round(delay / 60000)} minute(s), not immediately`)
  }

  setTimeout(() => {
    refreshNewsCache().catch(err => console.error('⚠️  News refresh cycle failed:', err.message))
    setInterval(() => {
      refreshNewsCache().catch(err => console.error('⚠️  News refresh cycle failed:', err.message))
    }, intervalMs)
  }, delay)
}

module.exports = { refreshNewsCache, scheduleNewsRefresh }
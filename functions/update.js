// ============================================
// /functions/update.js
// ============================================

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function isValidGenre(genre) {
  if (!genre || typeof genre !== 'string') return false;
  if (genre.length > 64) return false;
  return /^[a-zA-Z0-9_-]+$/.test(genre);
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

const MAX_DATA_BYTES = 5 * 1024 * 1024;

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const clientIP = request.headers.get("cf-connecting-ip") || "unknown";

  try {
    const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_DATA_BYTES + 1024) {
      return jsonError("Payload too large", 413);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonError("Invalid JSON body", 400);
    }

    const SECURE_PASSWORD = env.ADMIN_PASSWORD;

    if (!body.password || !SECURE_PASSWORD || !safeEqual(body.password, SECURE_PASSWORD)) {
      const failKey = `fail_${clientIP}`;
      let fails = 0;
      try {
        const failData = await env.MOVIE_DB.get(failKey);
        fails = failData ? parseInt(failData, 10) : 0;
        if (isNaN(fails)) fails = 0;
      } catch (e) {
        fails = 0;
      }
      fails++;
      context.waitUntil(
        env.MOVIE_DB.put(failKey, String(fails), { expirationTtl: 900 })
      );
      if (fails >= 5) {
        return jsonError("Too many failed attempts. Locked for 15 minutes.", 429);
      }
      return jsonError("Unauthorized", 401);
    }

    context.waitUntil(env.MOVIE_DB.delete(`fail_${clientIP}`));

    if (!isValidGenre(body.genre)) {
      return jsonError("Invalid genre", 400);
    }
    if (!body.data || typeof body.data !== 'string') {
      return jsonError("Invalid data", 400);
    }

    const dataBytes = new TextEncoder().encode(body.data).length;
    if (dataBytes > MAX_DATA_BYTES) {
      return jsonError("Data too large (max 5MB)", 413);
    }

    let parsedData;
    try {
      parsedData = JSON.parse(body.data);
    } catch (e) {
      return jsonError("Invalid JSON data", 400);
    }

    if (parsedData === null || typeof parsedData !== 'object') {
      return jsonError("Data must be an array or object", 400);
    }

    // ============================================
    // ✅ FIX: AUTO DEDUPLICATE before save
    // title + HD URL combo နဲ့ duplicate စစ်
    // ============================================
    if (Array.isArray(parsedData)) {
      const seen = new Set();
      parsedData = parsedData.filter(item => {
        if (!item || typeof item !== 'object') return true;
        const key = `${(item.title || '').trim().toLowerCase()}||${(item.HD || '').trim()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Deduplicate လုပ်ပြီးမှ stringify ပြန်လုပ်
    const cleanData = JSON.stringify(parsedData);

    // KV Save — main key
    await env.MOVIE_DB.put(body.genre, cleanData);

    // Pre-compute -show key
    if (Array.isArray(parsedData)) {
      const showData = JSON.stringify(parsedData.slice(0, 8));
      // ✅ FIX: await နဲ့ save — waitUntil မသုံး (purge မလုပ်ခင် save ပြီးဖို့)
      await env.MOVIE_DB.put(`${body.genre}-show`, showData);
    }

    // ============================================
    // SLIDER AUTO UPDATE
    // ============================================
    const sliderCategories = [
      "jav-mmsub", "jav-nosub",
      "usa-mmsub", "usa-nosub",
      "chinese-mmsub", "chinese-nosub",
      "yoteshin"
    ];

    let sliderUpdated = false;
    if (sliderCategories.includes(body.genre) && Array.isArray(parsedData)) {
      try {
        const otherCats = sliderCategories.filter(c => c !== body.genre);

        const otherFetches = otherCats.map(async (cat) => {
          try {
            const catData = await env.MOVIE_DB.get(cat);
            let movies = [];
            try {
              movies = JSON.parse(catData || "[]");
              if (!Array.isArray(movies)) movies = [];
            } catch (e) {
              movies = [];
            }
            return movies.slice(0, 3).map((movie, index) => ({
              ...movie,
              _source_category: cat,
              _order_index: index
            }));
          } catch (e) {
            return [];
          }
        });

        const currentMovies = parsedData.slice(0, 3).map((movie, index) => ({
          ...movie,
          _source_category: body.genre,
          _order_index: index
        }));

        const otherResults = await Promise.all(otherFetches);
        const allMovies = [...currentMovies];
        otherResults.forEach(catMovies => allMovies.push(...catMovies));

        allMovies.sort((a, b) => {
          if (a._order_index !== b._order_index) {
            return a._order_index - b._order_index;
          }
          return a._source_category.localeCompare(b._source_category);
        });

        const sliderMovies = allMovies
          .slice(0, 6)
          .map(({ _source_category, _order_index, ...clean }) => clean);

        const sliderJson = JSON.stringify(sliderMovies);
        const sliderShowJson = JSON.stringify(sliderMovies.slice(0, 8));

        await Promise.all([
          env.MOVIE_DB.put("slider-movie", sliderJson),
          env.MOVIE_DB.put("slider-movie-show", sliderShowJson)
        ]);

        sliderUpdated = true;
      } catch (e) {
        sliderUpdated = false;
      }
    }

    // ============================================
    // ✅ FIX: COMPLETE EDGE CACHE PURGE
    // ============================================
    const url = new URL(request.url);
    const baseOrigin = url.origin;
    const cache = caches.default;

    const purgeUrls = [
      // Main genre
      `${baseOrigin}/api?genre=${encodeURIComponent(body.genre)}`,
      // ✅ FIX: -show ကို သပ်သပ် encode
      `${baseOrigin}/api?genre=${encodeURIComponent(body.genre + "-show")}`,
      // ✅ FIX: "all" genre ပါ purge
      `${baseOrigin}/api?genre=all`,
    ];

    if (sliderUpdated) {
      purgeUrls.push(`${baseOrigin}/api?genre=slider-movie`);
      purgeUrls.push(`${baseOrigin}/api?genre=slider-movie-show`);
    }

    await Promise.all(
      purgeUrls.map(u =>
        cache.delete(new Request(u, { method: 'GET' })).catch(() => false)
      )
    );

    return new Response(JSON.stringify({
      success: true,
      message: "Updated successfully",
      sliderUpdated,
      // ✅ deduplicate လုပ်ပြီးတဲ့ count ပြပေး
      savedCount: Array.isArray(parsedData) ? parsedData.length : null
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        ...CORS_HEADERS
      }
    });

  } catch (e) {
    return jsonError("Server error", 500);
  }
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  });
}

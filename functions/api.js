// ============================================
// /functions/api.js
// Version-based caching — Region/VPN ပြဿနာ မရှိတော့ပါ
// Admin update လုပ်တိုင်း version တိုးပြီး cache key ပြောင်းသွားမယ်
// ============================================

export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');

    const userAgent = request.headers.get("user-agent") || "";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;
    const isAdmin = (pass && pass === SECURE_PASSWORD);

    // ============================================
    // STEP 1: BROWSER BLOCK (Anti-Scraping)
    // ============================================
    if (!isAdmin) {
        const browserPatterns = /Mozilla\/|Chrome\/|Safari\/|Opera\/|Edg\/|Firefox\//i;
        if (browserPatterns.test(userAgent)) {
            return new Response(
                `<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>`,
                { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } }
            );
        }
    }

    // ============================================
    // STEP 2: VERSION ကို KV မှ ဖတ်ခြင်း (very small read)
    // ဒီ version က Admin update တိုင်း ပြောင်းသွားလို့
    // Cache key က automatic invalidate ဖြစ်သွားမယ်
    // ============================================
    
    // Base genre (without -show) for version lookup
    const baseGenre = genre.endsWith("-show") ? genre.replace("-show", "") : genre;
    
    // Version ကို တိုက်ရိုက် KV ကနေ ဖတ်တာ — အလွန်နည်းပါးတဲ့ data သာဖြစ်လို့ မြန်တယ်
    // ဒီ version read ကိုလည်း cache လုပ်နိုင်ပေမယ့် TTL တိုတိုပဲထားမယ် (၃၀ စက္ကန့်)
    let version = "0";
    try {
        version = (await env.MOVIE_DB.get(`__v_${baseGenre}`)) || "0";
    } catch (e) {
        version = "0";
    }

    // ============================================
    // STEP 3: EDGE CACHE စစ်ဆေးခြင်း (version ပါတဲ့ key နဲ့)
    // ============================================
    const cacheUrl = new URL(request.url);
    cacheUrl.searchParams.delete('pass');
    cacheUrl.searchParams.set('v', version); // version ထည့်တာ — version ပြောင်းတာနဲ့ new cache key ဖြစ်သွားမယ်
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
    const cache = caches.default;

    if (!isAdmin) {
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
            return cachedResponse;
        }
    }

    // ============================================
    // STEP 4: KV DATABASE မှ ဖတ်ခြင်း
    // ============================================
    let responseBody;

    if (genre.endsWith("-show")) {
        const showData = await env.MOVIE_DB.get(genre);
        if (showData) {
            responseBody = showData;
        } else {
            const mainGenre = genre.replace("-show", "");
            const rawData = await env.MOVIE_DB.get(mainGenre);
            let list = [];
            try { list = JSON.parse(rawData || "[]"); } catch (e) { list = []; }
            responseBody = JSON.stringify(list.slice(0, 8));
        }
    } else {
        const data = await env.MOVIE_DB.get(genre);
        responseBody = data || "[]";
    }

    // ============================================
    // STEP 5: HEADERS သတ်မှတ်ခြင်း
    // ============================================
    // ETag ပါ ထည့်ပေးမယ် — version ပြောင်းတိုင်း ETag ပြောင်းသွားလို့
    // App က old ETag နဲ့ vequest လုပ်ရင် fresh data ပြန်ပေးတယ်
    const etag = `"${baseGenre}-${version}"`;
    
    const response = new Response(responseBody, {
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
            "ETag": etag,
            // max-age=0      → ဖုန်းမှာ မမှတ်ဖို့
            // s-maxage=7200  → Cloudflare မှာ ၂ နာရီထား (ဒါပေမယ့် version ပြောင်းတာနဲ့ new key ဖြစ်လို့ stale မဖြစ်တော့ပါ)
            // must-revalidate → ETag နဲ့ စစ်ဖို့
            "Cache-Control": isAdmin
                ? "no-store, no-cache, must-revalidate"
                : "public, max-age=0, s-maxage=7200, must-revalidate",
            "X-Data-Version": version
        }
    });

    // Cloudflare Edge Cache ထဲကို သိမ်းမည် (version key နဲ့)
    if (!isAdmin) {
        context.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
}

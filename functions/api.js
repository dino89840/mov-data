// ============================================
// /functions/api.js
// APK user တွေအတွက် KV မသုံးဘဲ Edge Cache သာသုံး
// Admin panel သာ KV ကိုတိုက်ရိုက်သုံးသည်
// ============================================

export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');

    const userAgent = request.headers.get("user-agent") || "";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;
    const isAdmin = pass && pass === SECURE_PASSWORD;

    // ============================================
    // STEP 1: ADMIN ACCESS — Password ပါရင် KV ကိုတိုက်ရိုက်ဖတ်
    // Admin panel ကသာ pass= parameter ပါပြီးခေါ်မည်
    // ============================================
    if (isAdmin) {
        const data = await env.MOVIE_DB.get(genre);
        return new Response(data || "[]", {
            headers: {
                "Content-Type": "application/json;charset=UTF-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store, no-cache"
            }
        });
    }

    // ============================================
    // STEP 2: BROWSER BLOCK (Admin မဟုတ်သောအခါ)
    // Desktop browser တွေကို 404 ပြမည်
    // APK / app တွေ browser UA မပါသောကြောင့် ဆက်သွားမည်
    // ============================================
    const browserPatterns = /Mozilla\/|Chrome\/|Safari\/|Opera\/|Edg\/|Firefox\//i;
    if (browserPatterns.test(userAgent)) {
        return new Response(
            `<!DOCTYPE html>
            <html><head><title>404 Not Found</title>
            <style>body{font-family:sans-serif;text-align:center;padding:80px;background:#f7fafc;}
            h1{color:#2d3748;font-size:48px;}p{color:#718096;}</style></head>
            <body><h1>404</h1><p>The page you requested could not be found.</p></body></html>`,
            {
                status: 404,
                headers: {
                    "Content-Type": "text/html;charset=UTF-8",
                    "Cache-Control": "public, max-age=3600"
                }
            }
        );
    }

    // ============================================
    // STEP 3: APK/APP USER — Edge Cache စစ်ဆေး
    // Cache hit ဖြစ်ရင် KV လုံးဝမသုံးဘဲ ပြန်ပေးမည်
    // ============================================
    const cacheUrl = new URL(request.url);
    cacheUrl.searchParams.delete('pass');
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
    const cache = caches.default;

    const cached = await cache.match(cacheKey);
    if (cached) {
        // Cache hit — KV လုံးဝမထိဘဲ ချက်ချင်းပြန်
        return cached;
    }

    // ============================================
    // STEP 4: Cache miss ဖြစ်မှသာ KV ကိုဖတ်
    // ဒီ code path ကို နည်းနိုင်သမျှနည်းအောင် Cache TTL ကိုမြင့်မားစွာ သတ်မှတ်
    // ============================================
    let responseBody;

    if (genre.endsWith("-show")) {
        // Pre-computed show key ကိုသာ ဖတ်
        const showData = await env.MOVIE_DB.get(genre);
        if (showData) {
            responseBody = showData;
        } else {
            // Fallback: main key မှ slice (legacy support)
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
    // STEP 5: Response ပြုလုပ် + Edge Cache သိမ်း
    // Cache TTL = 1 နာရီ (3600s)
    // stale-while-revalidate = 24 နာရီ
    // → APK user တွေ KV hit ကိုများစွာ လျှော့ချမည်
    // ============================================
    const response = new Response(responseBody, {
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
            // 1 နာရီ fresh cache + 24 နာရီ stale-while-revalidate
            // → user တိုင်း unlimited request လုပ်နိုင်ပြီး KV မ hit ဖြစ်
            "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400"
        }
    });

    // Background မှာ Edge Cache သိမ်း
    context.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
}

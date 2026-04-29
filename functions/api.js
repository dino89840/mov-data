// ============================================
// /functions/api.js
// KV Limit အပြည့်အဝ သက်သာစေရန် နှင့် 
// APK တွင် ဇာတ်ကား ၂ ခါထပ်သည့် ပြဿနာကို ဖြေရှင်းထားသည်
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
    // STEP 2: EDGE CACHE စစ်ဆေးခြင်း
    // ============================================
    const cacheUrl = new URL(request.url);
    cacheUrl.searchParams.delete('pass'); 
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
    const cache = caches.default;

    if (!isAdmin) {
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
            return cachedResponse; 
        }
    }

    // ============================================
    // STEP 3: KV DATABASE မှ ဖတ်ခြင်း
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
    // STEP 4: HEADERS သတ်မှတ်ခြင်း နှင့် CACHE သိမ်းခြင်း
    // APK ထဲတွင် ဇာတ်ကား ၂ ခါမထပ်စေရန် Cache-Control ကို ပြင်ဆင်ထားသည်
    // ============================================
    const response = new Response(responseBody, {
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
            // max-age=0: ဖုန်း (APK) ကို Local မှတ်ဉာဏ် လုံးဝမသုံးခိုင်းပါ (၂ ခါမထပ်အောင် ကာကွယ်သည်)
            // s-maxage=7200: Cloudflare Server ကိုတော့ ၂ နာရီ မှတ်ထားခိုင်းသည် (KV Limit မတက်အောင် ကာကွယ်သည်)
            "Cache-Control": isAdmin 
                ? "no-store, no-cache, must-revalidate" 
                : "public, max-age=0, s-maxage=7200, must-revalidate"
        }
    });

    if (!isAdmin) {
        context.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
}

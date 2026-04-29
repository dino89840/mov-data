// ============================================
// /functions/api.js
// Cloudflare တွင် KV Limit မတက်အောင် ၂ နာရီ Cache လုပ်ထားမည်
// သို့သော် APK ကို Local Cache လုံးဝ မလုပ်ရန် တားမြစ်ထားသည် (၂ ခါမထပ်စေရန်)
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
            // Cloudflare Server ပေါ်မှာ Cache ရှိနေရင် တိုက်ရိုက်ပြန်ပေးမည် (KV ကို မခေါ်ပါ)
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
    // STEP 4: HEADERS သတ်မှတ်ခြင်း (အရေးကြီးဆုံး)
    // ============================================
    const response = new Response(responseBody, {
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
            // ရှင်းလင်းချက်:
            // max-age=0      --> ဖုန်း (APK) ရဲ့ Storage ထဲမှာ လုံးဝ (လုံးဝ) မမှတ်ထားဖို့ အမိန့်ပေးတာပါ။ (ဒါကြောင့် ၂ ခါ မထပ်တော့ပါဘူး)
            // s-maxage=7200  --> Cloudflare Server ပေါ်မှာတော့ စက္ကန့် ၇၂၀၀ (၂ နာရီ) မှတ်ထားဖို့ အမိန့်ပေးတာပါ။ (ဒါကြောင့် KV Limit အလွန် သက်သာသွားပါမယ်)
            // must-revalidate--> ဖုန်းက Data ယူတိုင်း အင်တာနက်ကနေ အမြဲတမ်း အသစ်လှမ်းတောင်းဖို့ အမိန့်ပေးတာပါ။
            "Cache-Control": isAdmin 
                ? "no-store, no-cache, must-revalidate" 
                : "public, max-age=0, s-maxage=7200, must-revalidate"
        }
    });

    // Cloudflare Server (Edge Cache) ထဲကို သိမ်းမည်
    if (!isAdmin) {
        context.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
}

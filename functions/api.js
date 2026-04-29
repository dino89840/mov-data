// ============================================
// /functions/api.js
// KV Limit အပြည့်အဝ သက်သာစေရန် ပြင်ဆင်ထားသည်
// User (APK) များအတွက် Cache ကိုသာ တိုက်ရိုက်ပြန်ပေးမည်
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
    // Admin မဟုတ်ရင် Browser တွေကို Block မည် (APK ကလာတာကိုပဲ လက်ခံမည်)
    // ============================================
    if (!isAdmin) {
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
                    headers: { "Content-Type": "text/html;charset=UTF-8" }
                }
            );
        }
    }

    // ============================================
    // STEP 2: EDGE CACHE စစ်ဆေးခြင်း (အရေးကြီးဆုံးအပိုင်း)
    // Cache Key ထဲမှာ Password မပါအောင် ဖြုတ်ထားမည်
    // ============================================
    const cacheUrl = new URL(request.url);
    cacheUrl.searchParams.delete('pass'); 
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
    const cache = caches.default;

    // User (APK) အတွက် Cache ရှိမရှိ အရင်စစ်မည်
    // Cache ထဲမှာရှိရင် KV ကို လုံးဝ မသွားတော့ဘဲ ချက်ချင်းပြန်ပို့မည်။
    if (!isAdmin) {
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
            // 👈 KV ကိုမခေါ်ဘဲ Cache ကိုပဲ ပြန်ပေးလိုက်ပြီ (Unlimited Request ရပြီ)
            return cachedResponse; 
        }
    }

    // ============================================
    // STEP 3: KV DATABASE မှ ဖတ်ခြင်း
    // Admin ဝင်ကြည့်ချိန် (သို့) User အတွက် Cache သက်တမ်းကုန်သွားချိန်မှသာ အလုပ်လုပ်မည်
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
    // ============================================
    const response = new Response(responseBody, {
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
            // Admin အတွက် Cache လုံးဝမခံပါ။ (Data အမှန်ကို အမြဲမြင်ရမည်)
            // User(APK) အတွက် ၇၂၀၀ စက္ကန့် (၂ နာရီ) Cache ခံထားမည်။
            "Cache-Control": isAdmin 
                ? "no-store, no-cache, must-revalidate" 
                : "public, max-age=7200, s-maxage=7200"
        }
    });

    // APK User များအတွက် နောက်တစ်ခါ Request လာရင် တန်းယူလို့ရအောင် Cache ထဲ ထည့်သိမ်းမည်
    if (!isAdmin) {
        context.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
}

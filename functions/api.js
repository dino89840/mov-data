// ============================================
// /functions/api.js
// ⚠️ TESTING MODE ⚠️ 
// Cache အားလုံးကို လုံးဝ ပိတ်ထားပါသည်။ စမ်းသပ်ပြီးပါက မူလကုဒ်သို့ ပြန်ပြောင်းပါ။
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

    // ❌ EDGE CACHE စစ်ဆေးသည့်အပိုင်းကို လုံးဝ ဖယ်ရှားထားပါသည် (TESTING အတွက်) ❌

    // ============================================
    // STEP 2: KV DATABASE မှ တိုက်ရိုက်ဖတ်ခြင်း (အမြဲတမ်း)
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
    // STEP 3: CACHE လုံးဝမလုပ်ရန် HEADERS သတ်မှတ်ခြင်း
    // ============================================
    const response = new Response(responseBody, {
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
            // Cloudflare ရော, APK ပါ လုံးဝ မှတ်ဉာဏ်(Cache) မသုံးရန် အတင်းအကျပ် ပိတ်ထားသည်
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
        }
    });

    // ❌ CACHE သိမ်းသည့်အပိုင်းကိုလည်း လုံးဝ ဖယ်ရှားထားပါသည် (TESTING အတွက်) ❌

    return response;
}

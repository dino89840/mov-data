export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');

    const userAgent = request.headers.get("user-agent") || "";
    const clientIP = request.headers.get("cf-connecting-ip") ||
                     request.headers.get("x-forwarded-for") || "unknown";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;

    // ============================================
    // RATE LIMITING — IP တစ်ခုကို 1 မိနစ် 60 req
    // ============================================
    const rateLimitKey = `rl_${clientIP}`;
    try {
        const rlRaw = await env.MOVIE_DB.get(rateLimitKey);
        let rl = rlRaw ? JSON.parse(rlRaw) : { c: 0, r: Date.now() + 60000 };

        if (Date.now() > rl.r) {
            rl = { c: 0, r: Date.now() + 60000 };
        }
        rl.c++;

        // Admin ဆိုရင် limit ပိုများပေး
        const limit = (pass && pass === SECURE_PASSWORD) ? 300 : 60;

        if (rl.c > limit) {
            return new Response(JSON.stringify({ error: "Too Many Requests" }), {
                status: 429,
                headers: {
                    "Content-Type": "application/json",
                    "Retry-After": "60",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

        context.waitUntil(
            env.MOVIE_DB.put(rateLimitKey, JSON.stringify(rl), { expirationTtl: 120 })
        );
    } catch (e) {
        // Rate limit KV error ဆိုရင် ဆက်သွားမည် (block မလုပ်)
    }

    // ============================================
    // ADMIN ACCESS — Password ပါရင် အကုန်ပေး
    // ============================================
    if (pass && pass === SECURE_PASSWORD) {
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
    // BROWSER BLOCK
    // Browser UA ဖြင့် တိုက်ရိုက်ဝင်တာ ပိတ်မည်
    // APK တွေကတော့ Mozilla UA မသုံးဘဲ
    // custom UA သုံးလေ့ရှိတယ် — စစ်ဆေးပေးမည်
    // ============================================
    const browserPatterns = /Mozilla\/|Chrome\/|Safari\/|Opera\/|Edg\/|Firefox\//i;
    const isBrowser = browserPatterns.test(userAgent);

    // Postman, curl, wget ကတော့ browser မဟုတ်တဲ့အတွက် pass ပေးမည်
    // APK ရဲ့ UA ကို browser မတူရင် ok
    if (isBrowser) {
        // Browser ကနေ ဝင်ကြည့်တာ — fake 404 ပြမည်
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

    // ============================================
    // HOME SHOW ENDPOINT — APK Home (8 items)
    // ============================================
    if (genre.endsWith("-show")) {
        const mainGenre = genre.replace("-show", "");
        const rawData = await env.MOVIE_DB.get(mainGenre);
        let list = [];
        try { list = JSON.parse(rawData || "[]"); } catch (e) { list = []; }

        return new Response(JSON.stringify(list.slice(0, 8)), {
            headers: {
                "Content-Type": "application/json;charset=UTF-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=300"
            }
        });
    }

    // ============================================
    // NORMAL DATA — APK Full List
    // ============================================
    const data = await env.MOVIE_DB.get(genre);
    let parsedData = [];
    try { parsedData = JSON.parse(data || "[]"); } catch (e) { parsedData = []; }

    return new Response(JSON.stringify(parsedData), {
        headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=300"
        }
    });
}

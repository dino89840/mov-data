export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');

    const userAgent = request.headers.get("user-agent") || "";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;

    // ၁။ Admin Password ပါလာရင် (Owner ကြည့်တာဆိုရင်) ပေးမယ်
    if (pass && pass === SECURE_PASSWORD) {
        const data = await env.MOVIE_DB.get(genre);
        return new Response(data || "[]", {
            headers: { 
                "Content-Type": "application/json;charset=UTF-8", 
                "Access-Control-Allow-Origin": "*" 
            }
        });
    }

    // ၂။ Browser ကနေ Password မပါဘဲ တိုက်ရိုက်လာတာကို စစ်ဆေးမယ်
    // Mozilla, Chrome, Safari စတဲ့ browser စာသားတွေပါပြီး Password မပါရင် Denied လုပ်မယ်
    const isBrowser = userAgent.includes("Mozilla") || userAgent.includes("Chrome") || userAgent.includes("Safari");
    
    if (isBrowser && !pass) {
        return new Response("⛔ Access Denied: Direct browser access is not allowed for security reasons.", { 
            status: 403,
            headers: { "Content-Type": "text/plain;charset=UTF-8" }
        });
    }

    // ၃။ APK ကနေ လာတာဆိုရင် (သို့မဟုတ် Browser မဟုတ်ရင်) ပုံမှန်ပေးမယ်
    // genre-show ဖြစ်နေရင် ၈ ကားပဲ ဖြတ်ပေးမယ်
    if (genre.endsWith("-show")) {
        const mainGenre = genre.replace("-show", "");
        const rawData = await env.MOVIE_DB.get(mainGenre);
        let list = JSON.parse(rawData || "[]");
        return new Response(JSON.stringify(list.slice(0, 8)), {
            headers: { "Content-Type": "application/json;charset=UTF-8", "Access-Control-Allow-Origin": "*" }
        });
    }

    const data = await env.MOVIE_DB.get(genre);
    return new Response(data || "[]", {
        headers: { 
            "Content-Type": "application/json;charset=UTF-8", 
            "Access-Control-Allow-Origin": "*" 
        }
    });
}

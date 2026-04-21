export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');

    const userAgent = request.headers.get("user-agent") || "";
    const referer = request.headers.get("referer") || "";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;

    // ၁။ Admin Password ပါရင် Owner ဖြစ်လို့ အကုန်ပေးကြည့်မယ်
    if (pass && pass === SECURE_PASSWORD) {
        const data = await env.MOVIE_DB.get(genre);
        return new Response(data || "[]", {
            headers: { 
                "Content-Type": "application/json;charset=UTF-8", 
                "Access-Control-Allow-Origin": "*" 
            }
        });
    }

    // ၂။ တင်းကျပ်သော စစ်ဆေးမှု (Anti-Browser & Anti-Steal)
    // Browser တွေမှာ ပါတတ်တဲ့ Mozilla/5.0 ဆိုတဲ့စာသားပါရင် ပိတ်မယ်
    // ဒါမှမဟုတ် တစ်ခြား website တစ်ခုခုကနေ လှမ်းခေါ်ရင် (Referer ရှိရင်) ပိတ်မယ်
    const isBrowser = userAgent.includes("Mozilla") || userAgent.includes("Chrome") || userAgent.includes("Safari") || userAgent.includes("Edge");
    
    if (isBrowser || referer !== "") {
        // Password မပါဘဲ Browser ကနေ လာတာမှန်သမျှ "အကောင့်မရှိပါ" သို့မဟုတ် "ပိတ်ထားသည်" ပြမယ်
        return new Response(JSON.stringify({ error: "Unauthorized Access", message: "Please use official APK." }), { 
            status: 403,
            headers: { "Content-Type": "application/json;charset=UTF-8" }
        });
    }

    // ၃။ APK အတွက် Data ထုတ်ပေးခြင်း
    // genre-show အတွက် ၈ ကားပဲ ဖြတ်ပေးမယ်
    if (genre.endsWith("-show")) {
        const mainGenre = genre.replace("-show", "");
        const rawData = await env.MOVIE_DB.get(mainGenre);
        let list = JSON.parse(rawData || "[]");
        return new Response(JSON.stringify(list.slice(0, 8)), {
            headers: { 
                "Content-Type": "application/json;charset=UTF-8",
                "Access-Control-Allow-Origin": "*" 
            }
        });
    }

    // ပုံမှန် Genre အကုန်ပြမယ်
    const data = await env.MOVIE_DB.get(genre);
    return new Response(data || "[]", {
        headers: { 
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*" 
        }
    });
}

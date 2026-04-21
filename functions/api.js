export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass'); // Link မှာ တွဲရိုက်မည့် password

    const userAgent = request.headers.get("user-agent") || "";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD; 

    // ၁။ Admin Password မှန်ကန်ရင် (Owner ကြည့်တာဆိုရင်) ပေးမယ်
    if (pass && pass === SECURE_PASSWORD) {
        const data = await env.MOVIE_DB.get(genre);
        return new Response(data || "[]", {
            headers: { 
                "Content-Type": "application/json", 
                "Access-Control-Allow-Origin": "*" 
            }
        });
    }

    // ၂။ Browser ကနေ Password မပါဘဲ လာတာဆိုရင် ပိတ်မယ်
    const isBrowser = userAgent.includes("Mozilla") || userAgent.includes("Chrome") || userAgent.includes("Safari");
    if (isBrowser) {
        return new Response("Access Denied: Browser access is locked. Please use APK or enter Password.", { status: 403 });
    }

    // ၃။ APK ကနေ လာတာဆိုရင် (သို့မဟုတ် Browser မဟုတ်ရင်) ပုံမှန်ပေးမယ်
    const data = await env.MOVIE_DB.get(genre);
    return new Response(data || "[]", {
        headers: { 
            "Content-Type": "application/json", 
            "Access-Control-Allow-Origin": "*" 
        }
    });
}

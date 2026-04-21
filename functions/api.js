export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');

    const userAgent = request.headers.get("user-agent") || "";
    const SECURE_PASSWORD = env.ADMIN_PASSWORD;

    // Admin Pass စစ်ဆေးခြင်း
    const isAdmin = (pass && pass === SECURE_PASSWORD);

    if (!isAdmin) {
        const isBrowser = userAgent.includes("Mozilla") || userAgent.includes("Chrome") || userAgent.includes("Safari");
        if (isBrowser) {
            return new Response("Access Denied", { status: 403 });
        }
    }

    // တကယ်လို့ genre က '-show' နဲ့ ဆုံးနေရင် (ဥပမာ jav-mmsub-show)
    if (genre.endsWith("-show")) {
        const mainGenre = genre.replace("-show", ""); // မူရင်း genre ကို ရှာတယ်
        const rawData = await env.MOVIE_DB.get(mainGenre);
        let list = JSON.parse(rawData || "[]");
        
        // နောက်ဆုံးတင်တဲ့ ၈ ကားပဲ ဖြတ်ယူမယ်
        const showList = list.slice(0, 8); 
        return new Response(JSON.stringify(showList), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }

    // ပုံမှန် Genre ဆိုရင် အကုန်ပြမယ်
    const data = await env.MOVIE_DB.get(genre);
    return new Response(data || "[]", {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
}

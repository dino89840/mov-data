export async function onRequestGet(context) {
    const { env, request } = context;
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get('genre') || 'all';
    const pass = searchParams.get('pass');

    const SECURE_PASSWORD = env.ADMIN_PASSWORD;
    const data = await env.MOVIE_DB.get(genre);

    // ၁။ Admin Password မှန်ရင် (Owner ကြည့်တာဆိုရင်)
    if (pass === SECURE_PASSWORD) {
        return new Response(data || "[]", {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }

    // ၂။ genre က '-show' နဲ့ ဆုံးရင် နောက်ဆုံး ၈ ကားပဲ ပြမယ်
    if (genre.endsWith("-show")) {
        const mainGenre = genre.replace("-show", "");
        const rawData = await env.MOVIE_DB.get(mainGenre);
        let list = JSON.parse(rawData || "[]");
        return new Response(JSON.stringify(list.slice(0, 8)), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }

    // ၃။ ပုံမှန် APK ကနေ ခေါ်ယူမှုအတွက်
    return new Response(data || "[]", {
        headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*" // တစ်ခြား website တွေက ခိုးသုံးလို့မရအောင် ဒါကို နောက်ပိုင်းမှာ အစ်ကို့ domain နဲ့ ကန့်သတ်လို့ရပါတယ်
        }
    });
}

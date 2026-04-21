export async function onRequestPost(context) {
    const { env, request } = context;
    try {
        const body = await request.json();
        const SECURE_PASSWORD = env.ADMIN_PASSWORD;

        if (body.password !== SECURE_PASSWORD) {
            return new Response("Unauthorized", { status: 401 });
        }

        // KV ထဲမှာ Data သိမ်းမယ်
        await env.MOVIE_DB.put(body.genre, body.data);

        // Cache ကို Purge လုပ်ခြင်း (ရှင်းလင်းခြင်း)
        // Cloudflare Pages မှာ Cache ကို အတင်းရှင်းဖို့ response header မှာ age=0 ထည့်ပေးရပါတယ်
        return new Response("Updated & Cache Cleared", { 
            status: 200,
            headers: { 
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache, no-store, must-revalidate"
            }
        });

    } catch (e) {
        return new Response("Error: " + e.message, { status: 500 });
    }
}

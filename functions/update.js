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

        // --- Slider Movie Auto Update ---
        // movie category တွေထဲက တစ်ခုခု save လိုက်ရင် slider-movie ကို auto update လုပ်မယ်
        const sliderCategories = [
            "jav-mmsub",
            "jav-nosub",
            "usa-mmsub",
            "usa-nosub",
            "chinese-mmsub",
            "chinese-nosub",
            "yoteshin"
        ];

        if (sliderCategories.includes(body.genre)) {
            // category တစ်ခုချင်းစီရဲ့ data ကို KV ကနေယူမယ်
            // save လုပ်ခဲ့တဲ့ category ကတော့ body.data ကနေ တိုက်ရိုက်ယူမယ် (KV write ကနည်းနည်းနောက်ကျနိုင်လို့)
            let allMovies = [];

            for (const cat of sliderCategories) {
                let catData;
                if (cat === body.genre) {
                    // အခုပဲ save လိုက်တဲ့ category ဆိုရင် body.data ကနေယူမယ်
                    catData = body.data;
                } else {
                    catData = await env.MOVIE_DB.get(cat);
                }

                let movies = [];
                try {
                    movies = JSON.parse(catData || "[]");
                } catch (e) {
                    movies = [];
                }

                // movie တစ်ခုချင်းစီမှာ ဘယ် category ကလာတယ်ဆိုတာ tag လုပ်ပေးမယ်
                // timestamp ကို index အဖြစ်သုံးမယ် (array ရဲ့ index 0 က အသစ်ဆုံး)
                movies.forEach((movie, index) => {
                    allMovies.push({
                        ...movie,
                        _source_category: cat,
                        _order_index: index
                    });
                });
            }

            // အသစ်ဆုံး ၅ကားယူမယ်
            // array ထဲမှာ index 0 က အသစ်ဆုံးဖြစ်တယ်ဆိုတော့ _order_index နိမ့်တာက အသစ်ဆုံး
            // category တွေ အားလုံးထဲက index 0 တွေကို အရင်ယူမယ်၊ ပြီးရင် index 1 တွေ...
            allMovies.sort((a, b) => a._order_index - b._order_index);

            // နောက်ဆုံးတင်ထားတဲ့ ၅ကားယူမယ်
            const sliderMovies = allMovies.slice(0, 5).map(movie => {
                // _source_category နဲ့ _order_index ကို ဖယ်ထုတ်မယ် (clean data)
                const { _source_category, _order_index, ...cleanMovie } = movie;
                return cleanMovie;
            });

            // slider-movie category ထဲ save မယ်
            await env.MOVIE_DB.put("slider-movie", JSON.stringify(sliderMovies));
        }
        // --- End Slider Movie Auto Update ---

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

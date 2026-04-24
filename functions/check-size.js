export async function onRequestGet(context) {
    const { request } = context;
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');
    const checkType = searchParams.get('type') || 'size'; // 'size' or 'duration' or 'all'

    if (!url) {
        return new Response(JSON.stringify({ error: "No URL provided" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }

    try {
        // ==========================================
        // FILE SIZE CHECK (HEAD request)
        // ==========================================
        let sizeResult = { success: false, size: null, bytes: null };

        const headRes = await fetch(url, {
            method: 'HEAD',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const contentLength = headRes.headers.get('content-length');
        const contentType = headRes.headers.get('content-type') || '';

        if (contentLength) {
            const bytes = parseInt(contentLength);
            sizeResult = {
                success: true,
                bytes: bytes,
                size: formatSize(bytes),
                contentType: contentType
            };
        }

        // Size သာ လိုအပ်ရင် ဒီမှာပဲ return
        if (checkType === 'size') {
            return jsonResponse(sizeResult.success
                ? { success: true, size: sizeResult.size, bytes: sizeResult.bytes, contentType: contentType }
                : { success: false, error: "Content-Length မရရှိပါ။" }
            );
        }

        // ==========================================
        // DURATION CHECK (Range request + MP4 parse)
        // ==========================================
        let durationResult = { success: false, duration: null };

        // Video file မဟုတ်ရင် skip
        const isVideo = contentType.includes('video') ||
            url.toLowerCase().includes('.mp4') ||
            url.toLowerCase().includes('.mkv') ||
            url.toLowerCase().includes('.mov') ||
            url.toLowerCase().includes('.avi');

        if (isVideo || checkType === 'duration' || checkType === 'all') {
            durationResult = await getDuration(url, sizeResult.bytes);
        }

        // ==========================================
        // RETURN ALL RESULTS
        // ==========================================
        if (checkType === 'duration') {
            return jsonResponse(durationResult);
        }

        // 'all' - size + duration အပြည့်
        return jsonResponse({
            success: sizeResult.success || durationResult.success,
            size: sizeResult.size || null,
            bytes: sizeResult.bytes || null,
            contentType: contentType,
            duration: durationResult.duration || null,
            durationFormatted: durationResult.durationFormatted || null,
            durationSuccess: durationResult.success,
            sizeSuccess: sizeResult.success
        });

    } catch (e) {
        return jsonResponse({ success: false, error: "Fetch မအောင်မြင်ပါ: " + e.message }, 500);
    }
}

// ==========================================
// MP4 DURATION PARSER
// ==========================================
async function getDuration(url, totalBytes) {
    try {
        // နည်းလမ်း ၁: File အစကနေ 2MB ယူပြီး moov atom ရှာ
        const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB

        const rangeRes = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Range': `bytes=0-${CHUNK_SIZE - 1}`
            }
        });

        if (!rangeRes.ok && rangeRes.status !== 206) {
            throw new Error("Range request မထောက်ခံပါ");
        }

        const buffer = await rangeRes.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        // MP4 moov atom ထဲက mvhd box ကို ရှာမယ်
        let duration = findMP4Duration(bytes);

        if (duration) {
            return {
                success: true,
                duration: duration,
                durationFormatted: formatDuration(duration)
            };
        }

        // နည်းလမ်း ၂: moov atom က file အဆုံးမှာ ရှိရင် — နောက်ဆုံး 500KB ယူပြီးထပ်ကြည့်
        if (totalBytes && totalBytes > CHUNK_SIZE) {
            const endStart = Math.max(0, totalBytes - 512 * 1024);
            const endRes = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Range': `bytes=${endStart}-${totalBytes - 1}`
                }
            });

            if (endRes.ok || endRes.status === 206) {
                const endBuffer = await endRes.arrayBuffer();
                const endBytes = new Uint8Array(endBuffer);
                duration = findMP4Duration(endBytes);

                if (duration) {
                    return {
                        success: true,
                        duration: duration,
                        durationFormatted: formatDuration(duration)
                    };
                }
            }
        }

        return { success: false, error: "Duration ထုတ်ယူ၍မရပါ (moov atom မတွေ့ပါ)" };

    } catch (e) {
        return { success: false, error: "Duration parse error: " + e.message };
    }
}

// ==========================================
// MP4 MVHD BOX PARSER
// mvhd box ထဲမှာ duration & timescale ပါတယ်
// ==========================================
function findMP4Duration(bytes) {
    // 'mvhd' signature ကို ရှာမယ် (6d766864)
    const mvhd = [0x6d, 0x76, 0x68, 0x64];

    for (let i = 0; i < bytes.length - 100; i++) {
        if (bytes[i] === mvhd[0] &&
            bytes[i+1] === mvhd[1] &&
            bytes[i+2] === mvhd[2] &&
            bytes[i+3] === mvhd[3]) {

            // mvhd box တွေ့ပြီ
            // mvhd structure:
            // 4 bytes: box size
            // 4 bytes: 'mvhd'  <-- ဒီနေရာကနေ ရှာနေတာ (i position)
            // 1 byte:  version (0 or 1)
            // 3 bytes: flags

            const version = bytes[i + 4];

            let timescale, durationVal;

            if (version === 0) {
                // Version 0: 32-bit values
                // i+4: version
                // i+5..7: flags
                // i+8..11: creation time
                // i+12..15: modification time
                // i+16..19: timescale
                // i+20..23: duration
                timescale = readUint32(bytes, i + 16);
                durationVal = readUint32(bytes, i + 20);
            } else if (version === 1) {
                // Version 1: 64-bit time values
                // i+4: version
                // i+5..7: flags
                // i+8..15: creation time (64-bit)
                // i+16..23: modification time (64-bit)
                // i+24..27: timescale (32-bit)
                // i+28..35: duration (64-bit)
                timescale = readUint32(bytes, i + 24);
                // 64-bit duration (high 32 bits ကို ignore — practical video lengths အတွက် ok)
                durationVal = readUint32(bytes, i + 32);
            } else {
                continue;
            }

            if (timescale > 0 && durationVal > 0) {
                const seconds = Math.round(durationVal / timescale);
                if (seconds > 0 && seconds < 86400) { // 0 - 24 hours
                    return seconds;
                }
            }
        }
    }
    return null;
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================
function readUint32(bytes, offset) {
    return ((bytes[offset] << 24) |
            (bytes[offset+1] << 16) |
            (bytes[offset+2] << 8) |
             bytes[offset+3]) >>> 0;
}

function formatSize(bytes) {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
    if (bytes >= 1048576)    return (bytes / 1048576).toFixed(2) + " MB";
    if (bytes >= 1024)       return (bytes / 1024).toFixed(2) + " KB";
    return bytes + " B";
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${h}h ${m}m`; // "2h 15m"
    }
    return `${m}m ${s}s`;     // "45m 30s"
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        }
    });
}

// ============================================
// /functions/check-size.js
// Admin only — KV လုံးဝ မသုံးပါ
// ============================================

export async function onRequestGet(context) {
    const { request, env } = context;
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');
    const checkType = searchParams.get('type') || 'size';
    const pass = searchParams.get('pass');

    const SECURE_PASSWORD = env.ADMIN_PASSWORD;
    if (!pass || pass !== SECURE_PASSWORD) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
        });
    }

    if (!url) {
        return jsonResponse({ error: "No URL provided" }, 400);
    }

    try {
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return jsonResponse({ error: "Invalid URL protocol" }, 400);
        }
    } catch (e) {
        return jsonResponse({ error: "Invalid URL" }, 400);
    }

    const hostname = new URL(url).hostname;
    const privatePatterns = [
        /^localhost$/i,
        /^127\./,
        /^10\./,
        /^192\.168\./,
        /^172\.(1[6-9]|2[0-9]|3[01])\./,
        /^0\.0\.0\.0$/,
        /^::1$/,
        /^169\.254\./  // link-local
    ];
    if (privatePatterns.some(p => p.test(hostname))) {
        return jsonResponse({ error: "Private IP not allowed" }, 403);
    }

    try {
        let sizeResult = { success: false, size: null, bytes: null };

        const headRes = await fetch(url, {
            method: 'HEAD',
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MovieBot/1.0)' },
            redirect: 'follow'
        });

        const contentLength = headRes.headers.get('content-length');
        const contentType = headRes.headers.get('content-type') || '';

        if (contentLength) {
            const bytes = parseInt(contentLength);
            if (!isNaN(bytes) && bytes > 0) {
                sizeResult = {
                    success: true,
                    bytes,
                    size: formatSize(bytes),
                    contentType
                };
            }
        }

        if (checkType === 'size') {
            return jsonResponse(sizeResult.success
                ? { success: true, size: sizeResult.size, bytes: sizeResult.bytes, contentType }
                : { success: false, error: "Content-Length မရရှိပါ။" }
            );
        }

        let durationResult = { success: false };
        const isVideo = contentType.includes('video') ||
            /\.(mp4|mkv|mov|avi|webm)(\?|$)/i.test(url);

        if (isVideo || checkType === 'duration' || checkType === 'all') {
            durationResult = await getDuration(url, sizeResult.bytes);
        }

        if (checkType === 'duration') {
            return jsonResponse(durationResult);
        }

        return jsonResponse({
            success: sizeResult.success || durationResult.success,
            size: sizeResult.size || null,
            bytes: sizeResult.bytes || null,
            contentType,
            duration: durationResult.duration || null,
            durationFormatted: durationResult.durationFormatted || null,
            durationSuccess: durationResult.success,
            sizeSuccess: sizeResult.success
        });

    } catch (e) {
        return jsonResponse({ success: false, error: "Fetch မအောင်မြင်ပါ: " + e.message }, 500);
    }
}

async function getDuration(url, totalBytes) {
    try {
        const CHUNK_SIZE = 2 * 1024 * 1024;

        const rangeRes = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MovieBot/1.0)',
                'Range': `bytes=0-${CHUNK_SIZE - 1}`
            },
            redirect: 'follow'
        });

        if (!rangeRes.ok && rangeRes.status !== 206) {
            throw new Error("Range request မထောက်ခံပါ");
        }

        const buffer = await rangeRes.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let duration = findMP4Duration(bytes);

        if (duration) {
            return { success: true, duration, durationFormatted: formatDuration(duration) };
        }

        if (totalBytes && totalBytes > CHUNK_SIZE) {
            const endStart = Math.max(0, totalBytes - 512 * 1024);
            const endRes = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; MovieBot/1.0)',
                    'Range': `bytes=${endStart}-${totalBytes - 1}`
                },
                redirect: 'follow'
            });

            if (endRes.ok || endRes.status === 206) {
                const endBytes = new Uint8Array(await endRes.arrayBuffer());
                duration = findMP4Duration(endBytes);
                if (duration) {
                    return { success: true, duration, durationFormatted: formatDuration(duration) };
                }
            }
        }

        return { success: false, error: "Duration ထုတ်ယူ၍မရပါ (moov atom မတွေ့ပါ)" };

    } catch (e) {
        return { success: false, error: "Duration parse error: " + e.message };
    }
}

function findMP4Duration(bytes) {
    const mvhd = [0x6d, 0x76, 0x68, 0x64];
    for (let i = 0; i < bytes.length - 100; i++) {
        if (bytes[i] === mvhd[0] && bytes[i+1] === mvhd[1] &&
            bytes[i+2] === mvhd[2] && bytes[i+3] === mvhd[3]) {
            const version = bytes[i + 4];
            let timescale, durationVal;
            if (version === 0) {
                timescale = readUint32(bytes, i + 16);
                durationVal = readUint32(bytes, i + 20);
            } else if (version === 1) {
                timescale = readUint32(bytes, i + 24);
                durationVal = readUint32(bytes, i + 32);
            } else { continue; }

            if (timescale > 0 && durationVal > 0) {
                const seconds = Math.round(durationVal / timescale);
                if (seconds > 0 && seconds < 86400) return seconds;
            }
        }
    }
    return null;
}

function readUint32(bytes, offset) {
    return ((bytes[offset] << 24) | (bytes[offset+1] << 16) |
            (bytes[offset+2] << 8) | bytes[offset+3]) >>> 0;
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
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
}

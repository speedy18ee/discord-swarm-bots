const { Client, GatewayIntentBits, Events } = require("discord.js");
const {
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    getVoiceConnection,
    getVoiceConnections,
    joinVoiceChannel,
    StreamType,
    VoiceConnectionStatus,
    entersState
} = require("@discordjs/voice");
const youtubedl = require("youtube-dl-exec");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");
const { convertAvatar } = require("./convert-avatar");

// Automatically prepare avatar from source image/video if available
try {
    convertAvatar();
} catch (e) {
    console.warn("Avatar conversion check skipped:", e.message);
}

// ========== CONFIGURATION ==========
const appConfig = require("./config.json");
const prefix = process.env.PREFIX || appConfig.prefix || ".";
const ownerid = process.env.OWNER_ID
    ? process.env.OWNER_ID.split(',')
    : (appConfig.ownerid || []);
let botName = process.env.BOT_NAME || appConfig.botName || "𝑫𝑹𝑨𝑮𝑶𝑵 𝑹𝑰𝑺𝑬";
let botUsername = process.env.BOT_USERNAME || appConfig.botUsername || "DRAGON";
let botBio = process.env.BOT_BIO || appConfig.botBio || "🐉 Official DRAGON RISE Bot Swarm | High-Performance Discord Controller & Audio System";
let botAvatarPath = process.env.BOT_AVATAR_PATH || appConfig.botAvatarPath || "bot-avatar.png";
let botBannerPath = process.env.BOT_BANNER_PATH || appConfig.botBannerPath || "bot-banner.png";
const PRIMARY_BOT_INDEX = 1;

// FFMPEG path detection
let ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
try {
    const ffmpegStatic = require("ffmpeg-static");
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
        ffmpegPath = ffmpegStatic;
        console.log(`✅ FFMPEG found at: ${ffmpegPath}`);
    } else {
        const commonPaths = [
            '/usr/bin/ffmpeg',
            '/usr/local/bin/ffmpeg',
            '/app/vendor/ffmpeg/bin/ffmpeg',
            '/opt/ffmpeg/bin/ffmpeg'
        ];
        for (const testPath of commonPaths) {
            if (fs.existsSync(testPath)) {
                ffmpegPath = testPath;
                console.log(`✅ FFMPEG found at: ${ffmpegPath}`);
                break;
            }
        }
    }
} catch (e) {
    console.warn('⚠️ Could not check FFMPEG, using default path');
}

// ========== TOKEN CONFIGURATION ==========
const tokenFiles = [
    path.join(__dirname, "tokens.txt"),
    path.join(__dirname, "..", "tokens.txt")
];
let fileTokens = [];
for (const tokenFile of tokenFiles) {
    try {
        if (fs.existsSync(tokenFile)) {
            const lines = fs.readFileSync(tokenFile, "utf8").split(/[\r\n,;]+/).map(t => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
            if (lines.length > 0) {
                fileTokens.push(...lines);
                console.log(`📝 Found ${lines.length} tokens in ${path.basename(tokenFile)}`);
            }
        }
    } catch (e) {}
}

function decodeTokenIfNeeded(t) {
    if (!t || typeof t !== "string") return "";
    let clean = t.trim().replace(/^["']|["']$/g, "");
    if (clean.includes(".") && clean.length > 40) return clean;
    try {
        const decoded = Buffer.from(clean, "base64").toString("utf8");
        if (decoded.includes(".") && decoded.length > 40) return decoded;
    } catch (e) {}
    return clean;
}

const configTokensRaw = [
    ...(Array.isArray(appConfig.tokens) ? appConfig.tokens : []),
    ...(Array.isArray(appConfig.encodedTokens) ? appConfig.encodedTokens : [])
];
const configTokens = configTokensRaw.map(decodeTokenIfNeeded).filter(Boolean);

const rawEnvTokens = process.env.BOT_TOKENS || process.env.TOKENS || process.env.DISCORD_TOKENS || "";
const envTokens = rawEnvTokens
    ? rawEnvTokens.split(/[\r\n,;]+/).map(decodeTokenIfNeeded).filter(Boolean)
    : [];

const individualTokens = [];
for (let i = 1; i <= 50; i++) {
    const token = process.env[`BOT_TOKEN_${i}`] || process.env[`TOKEN_${i}`];
    if (token) individualTokens.push(decodeTokenIfNeeded(token));
}

const allFoundTokens = [
    ...envTokens,
    ...individualTokens,
    ...configTokens,
    ...fileTokens.map(decodeTokenIfNeeded)
];

const tokens = Array.from(new Set(allFoundTokens)).filter(t => t && t.length > 10);
console.log(`🔑 Loaded ${tokens.length} bot token(s)`);

if (tokens.length === 0) {
    console.error('❌ No tokens found! Set tokens in config.json, BOT_TOKENS environment variable, or tokens.txt');
    process.exit(1);
}

const ownerIds = new Set(
    (Array.isArray(ownerid) ? ownerid : [ownerid])
        .map(id => String(id).trim())
        .filter(Boolean)
);

const trustedAdminIds = new Set(
    (Array.isArray(appConfig.trustedAdmins) ? appConfig.trustedAdmins : [])
        .map(id => String(id).trim())
        .filter(Boolean)
);

function saveConfig() {
    try {
        const configPath = path.join(__dirname, "config.json");
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        config.prefix = prefix;
        config.botName = botName;
        config.botUsername = botUsername;
        config.botBio = botBio;
        config.botAvatarPath = botAvatarPath;
        config.botBannerPath = botBannerPath;
        config.ownerid = [...ownerIds];
        config.trustedAdmins = [...trustedAdminIds];
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4) + "\n");
    } catch (e) {
        console.warn("Could not save config:", e.message);
    }
}

async function fetchImageBuffer(urlOrAttachment) {
    if (!urlOrAttachment) return null;
    if (Buffer.isBuffer(urlOrAttachment)) return urlOrAttachment;
    if (typeof urlOrAttachment === "string" && !urlOrAttachment.startsWith("http://") && !urlOrAttachment.startsWith("https://")) {
        const localPath = path.resolve(__dirname, urlOrAttachment);
        if (fs.existsSync(localPath)) {
            return fs.readFileSync(localPath);
        }
    }
    const response = await axios.get(urlOrAttachment, {
        responseType: "arraybuffer",
        timeout: 20000,
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        maxContentLength: 15 * 1024 * 1024
    });
    return Buffer.from(response.data);
}

// ========== GLOBAL STATE & SWARM AUTOMATION ==========
const { LavalinkClient, DEFAULT_NODES } = require("./lavalink");

let lavalinkClient = null;

function parseBoolean(val) {
    if (typeof val === "boolean") return val;
    if (typeof val === "string") return val.trim().toLowerCase() === "true" || val.trim() === "1";
    return Boolean(val);
}

function setupLavalink(client) {
    if (process.env.LAVALINK_ENABLED === "false" || appConfig.lavalink?.enabled === false) return null;
    try {
        let configuredNodes = [];
        if (process.env.LAVALINK_NODES) {
            try {
                const parsed = JSON.parse(process.env.LAVALINK_NODES);
                if (Array.isArray(parsed) && parsed.length > 0) configuredNodes = parsed;
            } catch (e) {
                console.warn("[LAVALINK] Failed to parse LAVALINK_NODES env:", e.message);
            }
        }
        
        const fallbackNodes = Array.isArray(appConfig.lavalink?.nodes) && appConfig.lavalink.nodes.length > 0
            ? appConfig.lavalink.nodes
            : DEFAULT_NODES;

        if (configuredNodes.length === 0 && (process.env.LAVALINK_HOST || process.env.NODE_URL)) {
            let host = process.env.LAVALINK_HOST;
            let port = parseInt(process.env.LAVALINK_PORT || "443", 10);
            const nodeUrl = process.env.NODE_URL || "noi6.visihost.in:25591";
            if (!host && nodeUrl) {
                const cleaned = nodeUrl.replace(/^https?:\/\//, "").replace(/^wss?:\/\//, "");
                const parts = cleaned.split(":");
                host = parts[0];
                port = parts[1] ? parseInt(parts[1], 10) : 25591;
            }
            const password = process.env.NODE_AUTH || process.env.LAVALINK_PASSWORD || "ganahubkl";
            const secure = process.env.NODE_SECURE !== undefined
                ? (process.env.NODE_SECURE === "true" || process.env.NODE_SECURE === true)
                : (process.env.LAVALINK_SECURE === "true");

            const primaryNode = {
                name: process.env.NODE_NAME || "Lava Lenin",
                host,
                port,
                password,
                secure
            };

            // Include primary node first, followed by all backup nodes so audio never drops
            configuredNodes = [
                primaryNode,
                ...fallbackNodes.filter(n => !(n.host === host && (n.port || 443) === port))
            ];
        }

        if (configuredNodes.length === 0) {
            configuredNodes = fallbackNodes;
        }

        lavalinkClient = new LavalinkClient({
            nodes: configuredNodes,
            clientName: "DRAGON-RISE-Swarm/1.0"
        });

        client.on("raw", d => lavalinkClient?.updateVoiceState(d));
        client.manager = lavalinkClient;
        return lavalinkClient;
    } catch (err) {
        console.warn("[LAVALINK] Setup error:", err.message);
        return null;
    }
}

const audioCache = new Map();
const synchronizedStarts = new Map();
const botStates = new Set();
const playbackQueue = [];
let playbackActive = false;
let playbackStopPending = false;
let playbackRecoveryActive = false;
let sharedVolume = 1;
const processedPlayMessages = new Set();
const processedControlMessages = new Set();
let isShuttingDown = false;

// Swarm & Automation Tracking
const followState = {
    active: false,
    targetUserId: null,
    targetTag: null
};

let spamTaskIdCounter = 0;
const activeSpamTasks = new Map();
const activeDmSpamTasks = new Map();

function stopAllSpam() {
    const count = activeSpamTasks.size;
    for (const [id, task] of activeSpamTasks.entries()) {
        task.cancelled = true;
        if (task.timeout) clearTimeout(task.timeout);
    }
    activeSpamTasks.clear();
    return count;
}

function stopAllDmSpam() {
    const count = activeDmSpamTasks.size;
    for (const [id, task] of activeDmSpamTasks.entries()) {
        task.cancelled = true;
        if (task.timeout) clearTimeout(task.timeout);
    }
    activeDmSpamTasks.clear();
    return count;
}

// ========== UTILITY FUNCTIONS ==========
function stopActiveFfmpeg(state) {
    if (!state.ffmpeg || state.ffmpeg.exitCode !== null) {
        state.ffmpeg = null;
        return;
    }
    try {
        state.ffmpeg.kill('SIGTERM');
        setTimeout(() => {
            if (state.ffmpeg && state.ffmpeg.exitCode === null) {
                try {
                    state.ffmpeg.kill('SIGKILL');
                } catch (e) {}
            }
        }, 2000);
    } catch (e) {}
    state.ffmpeg = null;
}

function updatePlaybackPosition(state) {
    if (state.playbackStartedAt === null) return;
    state.playbackOffset += Math.max(0, (Date.now() - state.playbackStartedAt) / 1000);
    state.playbackStartedAt = null;
}

function resetPlaybackPosition(state) {
    state.playbackOffset = 0;
    state.playbackStartedAt = null;
}

function extractYouTubeVideoId(input) {
    if (!input || typeof input !== "string") return null;
    const cleanUrl = input.trim().replace(/^[<"']|[>"']$/g, "").trim();
    
    // Direct 11-char ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(cleanUrl)) {
        return cleanUrl;
    }
    
    const patterns = [
        /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/|live\/|e\/))([a-zA-Z0-9_-]{11})/i,
        /^(?:https?:\/\/)?(?:www\.|music\.|m\.)?youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/i,
        /^(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/i,
        /^(?:https?:\/\/)?(?:www\.|music\.|m\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i,
        /^(?:https?:\/\/)?(?:www\.|music\.|m\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/i
    ];
    
    for (const pattern of patterns) {
        const match = cleanUrl.match(pattern);
        if (match && match[1] && match[1].length === 11) {
            return match[1];
        }
    }
    
    const youtuBeMatch = cleanUrl.match(/youtu\.be\/([a-zA-Z0-9_-]+)/i);
    if (youtuBeMatch && youtuBeMatch[1] && youtuBeMatch[1].length >= 11) {
        return youtuBeMatch[1].slice(0, 11);
    }
    
    return null;
}

function isYouTubeUrl(url) {
    if (!url || typeof url !== "string") return false;
    const clean = url.trim().replace(/^[<"']|[>"']$/g, "").trim();
    return extractYouTubeVideoId(clean) !== null || /^(?:https?:\/\/)?(?:(?:www|music|m)\.)?youtube\.com\/\S+|^(?:https?:\/\/)?youtu\.be\/\S+/i.test(clean);
}

function normalizeYouTubeUrl(input) {
    if (!input || typeof input !== "string") return input;
    const videoId = extractYouTubeVideoId(input);
    if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
    }
    return input.trim().replace(/^[<"']|[>"']$/g, "").trim();
}

function isDirectAudioUrl(url) {
    if (!url || typeof url !== "string") return false;
    return /^https?:\/\/\S+\.(mp3|wav|ogg|opus|m4a|aac|flac|wma|aiff|alac|mp4|webm|mkv|mov|avi|flv|m4v|3gp)(?:\?[^\s]*)?$/i.test(url);
}

function isHttpUrl(url) {
    return /^https?:\/\/\S+$/i.test(url);
}

function isAudioAttachment(attachment) {
    if (!attachment) return false;
    const type = (attachment.contentType || "").toLowerCase();
    const name = (attachment.name || attachment.url || "").toLowerCase();
    const isVoiceMessage = Boolean(attachment.flags && (attachment.flags & 8192)); // Discord voice message flag
    return isVoiceMessage ||
        type.startsWith("audio/") ||
        type.startsWith("video/") ||
        /\.(mp3|wav|ogg|opus|m4a|aac|flac|wma|aiff|alac|mp4|webm|mkv|mov|avi|flv|m4v|3gp)(?:\?|$)/i.test(name);
}

function isDiscordAttachmentUrl(url) {
    if (!url || typeof url !== "string") return false;
    return /^https?:\/\/(?:cdn\.|media\.)?discord(?:app)?\.(?:com|net)\/attachments\//i.test(url);
}

async function fetchYouTubeTitle(videoIdOrUrl) {
    const videoId = extractYouTubeVideoId(videoIdOrUrl);
    const targetUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : videoIdOrUrl;
    try {
        const oembedRes = await axios.get(`https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`, {
            timeout: 5000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        if (oembedRes.data?.title) {
            return oembedRes.data.title;
        }
    } catch (e) {}
    return null;
}

async function searchYouTubeInnertube(query) {
    try {
        const response = await axios.post(
            "https://www.youtube.com/youtubei/v1/search?prettyPrint=false",
            {
                context: {
                    client: {
                        clientName: "ANDROID",
                        clientVersion: "19.09.37",
                        osName: "Android",
                        osVersion: "13"
                    }
                },
                query: query
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 13; en_US) gzip"
                },
                timeout: 8000
            }
        );

        const sections = response.data?.contents?.sectionListRenderer?.contents || [];
        for (const section of sections) {
            const items = section.itemSectionRenderer?.contents || [];
            for (const item of items) {
                const video = item.videoRenderer || item.compactVideoRenderer;
                if (video && video.videoId) {
                    const title = video.title?.runs?.[0]?.text || video.title?.simpleText || query;
                    return {
                        videoId: video.videoId,
                        url: `https://www.youtube.com/watch?v=${video.videoId}`,
                        title: title
                    };
                }
            }
        }
    } catch (e) {}
    return null;
}

async function searchYouTubeWeb(query) {
    try {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const res = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9"
            },
            timeout: 8000
        });
        const match = res.data.match(/ytInitialData\s*=\s*({.+?});<\/script>/s) || res.data.match(/var ytInitialData\s*=\s*({.+?});/s);
        if (match) {
            const data = JSON.parse(match[1]);
            const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
            for (const section of contents) {
                const items = section.itemSectionRenderer?.contents || [];
                for (const item of items) {
                    const video = item.videoRenderer;
                    if (video && video.videoId) {
                        const title = video.title?.runs?.[0]?.text || video.title?.simpleText || query;
                        return {
                            videoId: video.videoId,
                            url: `https://www.youtube.com/watch?v=${video.videoId}`,
                            title: title
                        };
                    }
                }
            }
        }
        const vidMatch = res.data.match(/\/watch\?v=([\w-]{11})/);
        if (vidMatch) {
            return {
                videoId: vidMatch[1],
                url: `https://www.youtube.com/watch?v=${vidMatch[1]}`,
                title: query
            };
        }
    } catch (e) {}
    return null;
}

async function fetchDirectPipedAudioStream(videoId) {
    if (!videoId) return null;
    const instances = [
        `https://pipedapi.smnz.de/streams/${videoId}`,
        `https://pipedapi.kavin.rocks/streams/${videoId}`,
        `https://piped-api.lunar.icu/streams/${videoId}`,
        `https://pipedapi.r4fo.com/streams/${videoId}`,
        `https://api.piped.projectsegfau.lt/streams/${videoId}`,
        `https://api.piped.privacydev.net/streams/${videoId}`,
        `https://invidious.jing.rocks/api/v1/videos/${videoId}`,
        `https://inv.us.projectsegfau.lt/api/v1/videos/${videoId}`,
        `https://inv.tux.pizza/api/v1/videos/${videoId}`
    ];

    // Try Cobalt API
    try {
        const cobaltRes = await axios.post(
            "https://api.cobalt.tools",
            { url: `https://www.youtube.com/watch?v=${videoId}`, downloadMode: "audio" },
            {
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                },
                timeout: 5000
            }
        );
        if (cobaltRes.data?.url) {
            return {
                url: cobaltRes.data.url,
                title: "YouTube Audio Stream"
            };
        }
    } catch (e) {}

    for (const instUrl of instances) {
        try {
            const res = await axios.get(instUrl, {
                timeout: 5000,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
            });
            const data = res.data;
            if (!data) continue;

            // Piped API schema
            if (Array.isArray(data.audioStreams) && data.audioStreams.length > 0) {
                const bestStream = data.audioStreams
                    .filter(s => s.url && !s.videoOnly)
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
                if (bestStream && bestStream.url) {
                    return {
                        url: bestStream.url,
                        title: data.title || "YouTube Audio Stream"
                    };
                }
            }

            // Invidious API schema
            if (Array.isArray(data.adaptiveFormats)) {
                const audioFormats = data.adaptiveFormats
                    .filter(f => f.url && (f.type?.startsWith("audio/") || f.mimeType?.startsWith("audio/")))
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                if (audioFormats.length > 0 && audioFormats[0].url) {
                    return {
                        url: audioFormats[0].url,
                        title: data.title || "YouTube Audio Stream"
                    };
                }
            }
        } catch (e) {}
    }
    return null;
}

function formatToNetscapeCookies(rawText) {
    if (!rawText) return "";
    let text = rawText.trim();
    if (/^[A-Za-z0-9+/=\s]{100,}$/.test(text) && !text.includes('\t') && !text.includes('=')) {
        try {
            const decoded = Buffer.from(text, 'base64').toString('utf8');
            if (decoded.includes('youtube.com') || decoded.includes('\t') || decoded.includes('=')) {
                text = decoded;
            }
        } catch (e) {}
    }
    if (text.includes('\t') || text.startsWith('# Netscape') || text.includes('.youtube.com\t')) {
        return text;
    }
    if (text.includes('=')) {
        const lines = [
            '# Netscape HTTP Cookie File',
            '# https://curl.haxx.se/rfc/cookie_spec.html',
            '# This is a generated file! Do not edit.',
            ''
        ];
        const pairs = text.split(/;\s*/);
        const expiry = Math.floor(Date.now() / 1000) + 315360000;
        for (const pair of pairs) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx > 0) {
                const name = pair.slice(0, eqIdx).trim();
                const value = pair.slice(eqIdx + 1).trim();
                if (name && value) {
                    lines.push(`.youtube.com\tTRUE\t/\tTRUE\t${expiry}\t${name}\t${value}`);
                }
            }
        }
        return lines.join('\n');
    }
    return text;
}

function getYouTubeCookieFile() {
    const cookieText = process.env.YOUTUBE_COOKIES || process.env.COOKIES || process.env.COOKIE || process.env.YOUTUBE_COOKIE;
    if (cookieText?.trim()) {
        const cookieFile = path.join(os.tmpdir(), "discord-youtube-cookies.txt");
        const formatted = formatToNetscapeCookies(cookieText);
        fs.writeFileSync(cookieFile, formatted, { encoding: "utf8", mode: 0o600 });
        return cookieFile;
    }
    const cookieFile = process.env.YOUTUBE_COOKIES_FILE || path.join(__dirname, "cookies.txt");
    return fs.existsSync(cookieFile) && fs.statSync(cookieFile).size > 0 ? cookieFile : null;
}

function updateAllBotStates(update) {
    for (const botState of botStates) update(botState);
}

function getSynchronizedStart(messageId) {
    if (!synchronizedStarts.has(messageId)) {
        synchronizedStarts.set(messageId, Date.now() + 1000);
        setTimeout(() => synchronizedStarts.delete(messageId), 10000).unref?.();
    }
    return synchronizedStarts.get(messageId);
}

function waitUntil(timestamp) {
    const delay = timestamp - Date.now();
    if (delay > 0) return new Promise(resolve => setTimeout(resolve, delay));
    return Promise.resolve();
}

function safelyDestroyConnection(connection) {
    if (!connection || connection.state?.status === VoiceConnectionStatus.Destroyed) return;
    try {
        connection.destroy();
    } catch (error) {
        if (!/already been destroyed/i.test(error.message)) throw error;
    }
}

function destroyConnection(state, guildId) {
    const connection = state.connection;
    state.connection = null;
    safelyDestroyConnection(connection);
    if (guildId) {
        const cachedConnection = getVoiceConnection(guildId, state.voiceGroup);
        safelyDestroyConnection(cachedConnection);
        getVoiceConnections(state.voiceGroup)?.delete(guildId);
    }
}

function destroyAllConnections(guildId) {
    for (const botState of botStates) {
        destroyConnection(botState, guildId);
        botState.currentUrl = null;
    }
}

// ========== PERMISSION CHECK & REPLY ==========
async function safeReply(message, content) {
    if (!message || !message.channel || isShuttingDown) return;
    try {
        if (content && content.length > 2000) {
            content = content.substring(0, 1990) + '...';
        }
        await message.reply(content);
    } catch (error) {
        try {
            await message.channel.send(content);
        } catch (chanErr) {
            console.error(`[REPLY ERROR] Missing SendMessages permission in #${message.channel?.name || 'channel'}: ${chanErr.message}`);
        }
    }
}

function reply(message, content) {
    return safeReply(message, content);
}

async function connectBotToVoiceChannel(state, voiceChannel, retries = 1) {
    const botUser = state.client.user;
    if (!botUser) throw new Error("Bot is not logged in; check token");

    const guildId = voiceChannel.guild?.id || voiceChannel.guildId;
    const channelId = voiceChannel.id;

    let targetGuild = state.client.guilds.cache.get(guildId);
    if (!targetGuild) {
        targetGuild = await state.client.guilds.fetch(guildId).catch(() => null);
    }
    if (!targetGuild) throw new Error(`Bot is not in server (${guildId})`);

    // If already connected to target channel and Ready, just ensure player is subscribed
    if (state.connection && state.connection.joinConfig?.channelId === channelId) {
        const currentStatus = state.connection.state?.status;
        if (currentStatus === VoiceConnectionStatus.Ready) {
            state.connection.subscribe(state.audioPlayer);
            return;
        }
        if (currentStatus === VoiceConnectionStatus.Connecting || currentStatus === VoiceConnectionStatus.Signalling) {
            try {
                await entersState(state.connection, VoiceConnectionStatus.Ready, 15000);
                state.connection.subscribe(state.audioPlayer);
                return;
            } catch (e) {
                // Connection negotiation timed out, re-join below
            }
        }
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            if (state.connection && state.connection.state?.status !== VoiceConnectionStatus.Destroyed) {
                try { state.connection.destroy(); } catch (e) {}
            }

            state.connection = joinVoiceChannel({
                channelId: channelId,
                guildId: guildId,
                adapterCreator: targetGuild.voiceAdapterCreator,
                group: state.voiceGroup,
                selfDeaf: false
            });

            state.connection.on(VoiceConnectionStatus.Disconnected, () => {
                if (state.connection?.state.status === VoiceConnectionStatus.Disconnected) {
                    state.connection = null;
                }
            });

            state.connection.on("error", error => {
                if (!error.message?.includes("socket closed") && !error.message?.includes("aborted")) {
                    console.error(`[${state.client.user?.tag || "BOT"}] Voice error: ${error.message}`);
                }
            });

            await entersState(state.connection, VoiceConnectionStatus.Ready, 15000);
            state.connection.subscribe(state.audioPlayer);
            return;
        } catch (error) {
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 600));
                continue;
            }
            destroyConnection(state, guildId);
            throw new Error(`Voice connection failed: ${error.message}`);
        }
    }
}

async function connectAllBotsToVoiceChannel(voiceChannel) {
    const botArray = Array.from(botStates);
    const results = [];
    
    // Batch joins in small groups to prevent Discord Gateway op:4 voice rate limits
    const BATCH_SIZE = 6;
    for (let i = 0; i < botArray.length; i += BATCH_SIZE) {
        const batch = botArray.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
            batch.map(bState => connectBotToVoiceChannel(bState, voiceChannel))
        );
        results.push(...batchResults);
        if (i + BATCH_SIZE < botArray.length) {
            await new Promise(resolve => setTimeout(resolve, 60));
        }
    }

    let joinedCount = 0;
    const errors = [];
    results.forEach((res, idx) => {
        const bState = botArray[idx];
        if (res.status === "fulfilled") {
            joinedCount++;
        } else {
            const err = res.reason;
            if (!err?.message?.includes("is not in server")) {
                console.error(`[BOT ${bState.botIndex} JOIN ERROR]`, err?.message || err);
            }
            errors.push(`Bot ${bState.botIndex} (${bState.client.user?.tag || 'offline'}): ${err?.message || 'Failed'}`);
        }
    });
    return { joinedCount, errors };
}

// ========== EQUALIZER APO & DSP PRESET LOADER ==========
function parseApoFilters(apoText) {
    if (!apoText) return [];
    const ffmpegFilters = [];
    const lines = apoText.split(/[\r\n]+/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        // Preamp: +X dB
        const preampMatch = trimmed.match(/^Preamp:\s*([+-]?\d+(?:\.\d+)?)\s*dB/i);
        if (preampMatch) {
            const dbVal = Math.min(24, Math.max(-24, parseFloat(preampMatch[1])));
            ffmpegFilters.push(`volume=${dbVal}dB`);
            continue;
        }

        // Filter: ON PK/LS/HS Fc 125.61 Hz Gain 20 dB
        const filterMatch = trimmed.match(/Filter(?:\s*\d+)?:\s*(?:ON\s+)?(PK|LS|HS|LSC|HSC|AP|BP)\s+Fc\s+(\d+(?:\.\d+)?)\s*Hz\s+Gain\s+([+-]?\d+(?:\.\d+)?)\s*dB(?:\s+Q\s+(\d+(?:\.\d+)?))?/i);
        if (filterMatch) {
            const type = filterMatch[1].toUpperCase();
            const freq = parseFloat(filterMatch[2]).toFixed(1);
            const gain = parseFloat(filterMatch[3]).toFixed(1);
            const q = filterMatch[4] ? parseFloat(filterMatch[4]).toFixed(2) : "1.0";

            if (type === "PK") {
                ffmpegFilters.push(`equalizer=f=${freq}:t=q:w=${q}:g=${gain}`);
            } else if (type === "LS" || type === "LSC") {
                ffmpegFilters.push(`bass=g=${gain}:f=${freq}:w=${q}`);
            } else if (type === "HS" || type === "HSC") {
                ffmpegFilters.push(`equalizer=f=${freq}:t=h:w=${q}:g=${gain}`);
            }
            continue;
        }

        // VST Plugin DSP modeling for Equalizer APO presets
        if (/QuickHaas/i.test(trimmed)) {
            ffmpegFilters.push("haas=level_in=1.0:side_gain=0.75");
        } else if (/Wider/i.test(trimmed)) {
            ffmpegFilters.push("extrastereo=m=1.6");
        } else if (/ClipShifter|CamelCrusher|loudest|OVC-128|GGain/i.test(trimmed)) {
            ffmpegFilters.push("compand=attacks=0.002:decays=0.04:points=-90/-90|-40/-4|-10/0|0/0:gain=10");
        } else if (/DeeSubBass|LF Max Punch/i.test(trimmed)) {
            ffmpegFilters.push("bass=g=16:f=60:w=0.8,equalizer=f=95:t=q:w=1.2:g=12");
        } else if (/FabFilter|Pro-Q/i.test(trimmed)) {
            ffmpegFilters.push("equalizer=f=3200:t=q:w=1.2:g=3,treble=g=3:f=11000");
        }
    }
    return ffmpegFilters;
}

function loadEqualizerApoConfig() {
    const candidatePaths = [
        path.join(__dirname, "Apo sore"),
        path.join(__dirname, "apo sore"),
        path.join(__dirname, "Apo score"),
        path.join(__dirname, "Apo sore.txt"),
        path.join(__dirname, "config.txt"),
        path.join(__dirname, "..", "Apo sore")
    ];

    const foundFiles = [];
    const seenFiles = new Set();
    for (const p of candidatePaths) {
        if (!fs.existsSync(p)) continue;
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
            try {
                const subFiles = fs.readdirSync(p);
                for (const sub of subFiles) {
                    if (sub.endsWith(".txt") || sub.endsWith(".conf")) {
                        const fullPath = path.resolve(p, sub);
                        const key = fullPath.toLowerCase();
                        if (!seenFiles.has(key)) {
                            seenFiles.add(key);
                            foundFiles.push(fullPath);
                        }
                    }
                }
            } catch (e) {}
        } else if (stat.isFile()) {
            const fullPath = path.resolve(p);
            const key = fullPath.toLowerCase();
            if (!seenFiles.has(key)) {
                seenFiles.add(key);
                foundFiles.push(fullPath);
            }
        }
    }

    const allFilters = [];
    for (const file of foundFiles) {
        try {
            const content = fs.readFileSync(file, "utf8");
            const filters = parseApoFilters(content);
            if (filters.length > 0) {
                console.log(`🎛️ Applied Equalizer APO preset from: ${path.basename(file)}`);
                allFilters.push(...filters);
            }
        } catch (e) {}
    }

    return allFilters.length > 0 ? allFilters : null;
}

// ========== AUDIO FUNCTIONS ==========
function getBassGain(state) {
    if (state.bassboost) return state.bassboostGain || 12;
    return 0;
}

function getPlaybackVolume(state) {
    const dbMultiplier = state.dbGain ? Math.pow(10, state.dbGain / 20) : 1;
    return Math.max(0.01, state.volume * dbMultiplier);
}

function updateResourceVolume(state) {
    try {
        const vol = getPlaybackVolume(state);
        if (state.resource?.volume) {
            state.resource.volume.setVolume(vol);
        }
    } catch (e) {
        console.warn(`[BOT ${state.botIndex}] Volume set error:`, e.message);
    }
}

function createResource(state, audio) {
    stopActiveFfmpeg(state);
    
    const filters = [];
    const input = audio.filePath || audio.url;
    
    const reconnectArgs = audio.url && !audio.filePath
        ? ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"]
        : [];
    
    const userAgentArgs = audio.url && !audio.filePath
        ? ["-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"]
        : [];
    
    // Sub-audible cleanup to keep low-end tight without rumble
    filters.push("highpass=f=25");

    // Check if custom Equalizer APO preset file is loaded
    const apoFilters = loadEqualizerApoConfig();
    if (apoFilters && apoFilters.length > 0) {
        filters.push(...apoFilters);
    }

    // Dynamic Bass Boost & Clarity
    const bassGain = getBassGain(state);
    if (bassGain > 0) {
        filters.push(`bass=g=${bassGain.toFixed(1)}:f=65:w=0.8`);
        filters.push(`equalizer=f=45:t=q:w=1.2:g=${Math.min(30, bassGain * 0.95).toFixed(1)}`);
        filters.push(`equalizer=f=95:t=q:w=1:g=${Math.min(24, bassGain * 0.7).toFixed(1)}`);
    }
    
    // Vocal clarity & treble sparkle
    filters.push("equalizer=f=3200:t=q:w=1.2:g=2.5");
    filters.push("treble=g=2:f=11000");

    // Real-time zero-delay Loudness Maximizer & Limiter (instant audio stream)
    filters.push("volume=6dB,compand=attacks=0.002:decays=0.05:points=-90/-90|-40/-4|-10/0|0/0:gain=10,alimiter=limit=0.99:level=true:attack=2:release=25");
    
    const ffmpegArgs = [
        "-hide_banner",
        "-loglevel", "error",
        "-probesize", "1000k",
        "-analyzeduration", "1000k",
        ...userAgentArgs,
        ...reconnectArgs,
        ...(state.playbackOffset > 0 ? ["-ss", String(Math.floor(state.playbackOffset))] : []),
        "-i", input,
        "-vn",
        ...(filters.length > 0 ? ["-af", filters.join(",")] : []),
        "-f", "s16le",
        "-ar", "48000",
        "-ac", "2",
        "pipe:1"
    ];
    
    const ffmpeg = spawn(ffmpegPath, ffmpegArgs, { 
        stdio: ["ignore", "pipe", "pipe"]
    });
    
    state.ffmpeg = ffmpeg;
    
    ffmpeg.stderr.on("data", data => {
        const text = data.toString();
        if (text.includes("fatal") || (text.includes("Error") && !text.includes("Connection reset") && !text.includes("Immediate exit"))) {
            console.error(`[FFMPEG ERROR] ${text.trim()}`);
        }
    });
    
    ffmpeg.stdout.on("error", error => {
        if (error.code !== "EPIPE" && error.code !== "ECONNRESET") {
            console.error(`[FFMPEG STREAM ERROR] ${error.message}`);
        }
    });
    
    ffmpeg.on("close", () => {
        if (state.ffmpeg === ffmpeg) {
            updatePlaybackPosition(state);
            state.ffmpeg = null;
        }
    });
    
    ffmpeg.on("error", error => {
        if (error.code !== "EPIPE" && error.code !== "ECONNRESET") {
            console.error(`[FFMPEG PROCESS ERROR] ${error.message}`);
            state.streamFailed = true;
        }
    });
    
    const resource = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.Raw,
        inlineVolume: true
    });
    
    resource.volume.setVolume(getPlaybackVolume(state));
    return resource;
}

async function getAudioUrl(url) {
    // Check if input is a local MP4 / recorded file
    if (url && typeof url === "string" && !url.startsWith("http://") && !url.startsWith("https://")) {
        const potentialLocalPaths = [
            path.resolve(url),
            path.resolve(__dirname, url),
            path.resolve(__dirname, "recordings", url),
            path.resolve(__dirname, "..", url)
        ];
        for (const localPath of potentialLocalPaths) {
            try {
                if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
                    console.log(`[LOCAL MEDIA] Playing local MP4/recording: ${localPath}`);
                    return {
                        filePath: localPath,
                        url: null,
                        title: path.basename(localPath),
                        isYouTube: false
                    };
                }
            } catch (e) {}
        }
    }

    const isDirectAudio = isDirectAudioUrl(url) || isDiscordAttachmentUrl(url);
    if (isDirectAudio) {
        let mediaTitle = "Media Stream";
        let ext = ".mp3";
        try {
            const parsed = new URL(url);
            const base = path.basename(parsed.pathname);
            if (base && !base.startsWith("ephemeral_") && base.includes(".")) {
                mediaTitle = decodeURIComponent(base);
                ext = path.extname(base) || ".mp3";
            }
        } catch (e) {}

        const localDest = path.join(os.tmpdir(), `discord-media-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        try {
            console.log(`[ATTACHMENT] Downloading recording/media attachment: "${mediaTitle}"...`);
            const writer = fs.createWriteStream(localDest);
            const response = await axios({
                url,
                method: "GET",
                responseType: "stream",
                timeout: 30000,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
            });
            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on("finish", resolve);
                writer.on("error", reject);
            });

            if (fs.existsSync(localDest) && fs.statSync(localDest).size > 256) {
                console.log(`[ATTACHMENT] Successfully downloaded recording (${fs.statSync(localDest).size} bytes) for multi-bot playback`);
                return {
                    filePath: localDest,
                    url: null,
                    title: mediaTitle,
                    isYouTube: false
                };
            }
        } catch (downloadErr) {
            console.warn(`[ATTACHMENT DOWNLOAD WARNING] ${downloadErr.message}, playing direct stream...`);
        }

        return {
            filePath: null,
            url: url,
            title: mediaTitle,
            isYouTube: false
        };
    }

    let targetUrl = url;
    let exactTitle = url;
    let isYt = false;

    const videoId = extractYouTubeVideoId(url);
    if (videoId) {
        targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
        isYt = true;
        const fetchedTitle = await fetchYouTubeTitle(videoId);
        if (fetchedTitle) exactTitle = fetchedTitle;
    } else if (isHttpUrl(url)) {
        targetUrl = url;
        isYt = isYouTubeUrl(url);
    } else {
        // Search query: resolve to exact YouTube video first!
        console.log(`[SEARCH] Resolving song query: "${url}"`);
        const innertubeRes = await searchYouTubeInnertube(url);
        if (innertubeRes) {
            targetUrl = innertubeRes.url;
            exactTitle = innertubeRes.title;
            isYt = true;
            console.log(`[SEARCH] Found match: "${exactTitle}" (${targetUrl})`);
        } else {
            const webRes = await searchYouTubeWeb(url);
            if (webRes) {
                targetUrl = webRes.url;
                exactTitle = webRes.title;
                isYt = true;
                console.log(`[SEARCH] Found match via web: "${exactTitle}" (${targetUrl})`);
            } else {
                targetUrl = `ytsearch1:${url}`;
                isYt = true;
            }
        }
    }

    const outputPath = path.join(os.tmpdir(), `discord-music-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);

    // Zero-cookie fast direct stream extraction for YouTube videos
    const resolvedVideoId = videoId || extractYouTubeVideoId(targetUrl);
    if (resolvedVideoId) {
        try {
            const directStream = await fetchDirectPipedAudioStream(resolvedVideoId);
            if (directStream && directStream.url) {
                console.log(`[ZERO-COOKIE STREAM] Direct stream resolved for "${exactTitle || directStream.title}", caching for multi-bot swarm...`);
                try {
                    const writer = fs.createWriteStream(outputPath);
                    const streamRes = await axios({
                        url: directStream.url,
                        method: "GET",
                        responseType: "stream",
                        timeout: 25000,
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                        }
                    });
                    streamRes.data.pipe(writer);
                    await new Promise((resolve, reject) => {
                        writer.on("finish", resolve);
                        writer.on("error", reject);
                    });

                    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) {
                        console.log(`[STREAM CACHED] Downloaded ${fs.statSync(outputPath).size} bytes for seamless multi-bot playback`);
                        return {
                            filePath: outputPath,
                            url: null,
                            title: exactTitle || directStream.title,
                            isYouTube: true
                        };
                    }
                } catch (dlErr) {
                    console.warn(`[STREAM CACHE NOTE] ${dlErr.message}, playing direct stream`);
                }

                return {
                    filePath: null,
                    url: directStream.url,
                    title: exactTitle || directStream.title,
                    isYouTube: true
                };
            }
        } catch (pipedErr) {}
    }

    const cookieFile = getYouTubeCookieFile();
    let ffmpegDir = undefined;
    try {
        if (ffmpegPath && fs.existsSync(ffmpegPath)) {
            ffmpegDir = fs.statSync(ffmpegPath).isDirectory() ? ffmpegPath : path.dirname(ffmpegPath);
        }
    } catch (e) {}

    // Multi-client extraction strategies
    const strategies = [];
    if (isYt || !isHttpUrl(targetUrl)) {
        if (cookieFile) {
            strategies.push({ client: "web", useCookies: true });
            strategies.push({ client: "ios", useCookies: true });
            strategies.push({ client: "android", useCookies: true });
        }
        strategies.push({ client: "android", useCookies: false });
        strategies.push({ client: "ios", useCookies: false });
        strategies.push({ client: "tv_embedded", useCookies: false });
        strategies.push({ client: "web_creator", useCookies: false });
        strategies.push({ client: "mweb", useCookies: false });
        strategies.push({ client: undefined, useCookies: false });
    } else {
        strategies.push({ client: undefined, useCookies: false });
    }

    let lastError = null;

    for (const strat of strategies) {
        try {
            const ytdlOptions = {
                noPlaylist: true,
                format: "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
                noWarnings: true,
                noCheckCertificates: true,
                geoBypass: true,
                output: outputPath,
                extractAudio: true,
                audioFormat: "mp3",
                audioQuality: "0",
                socketTimeout: 15,
                ...(ffmpegDir ? { ffmpegLocation: ffmpegDir } : {}),
                ...(strat.client ? { extractorArgs: `youtube:player_client=${strat.client}` } : {}),
                ...(strat.useCookies && cookieFile ? { cookies: cookieFile } : {})
            };

            await youtubedl(targetUrl, ytdlOptions);

            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 2048) {
                lastError = null;
                if (exactTitle === url || exactTitle === targetUrl || exactTitle === "YouTube Audio") {
                    try {
                        const info = await youtubedl(targetUrl, {
                            dumpSingleJson: true,
                            noPlaylist: true,
                            socketTimeout: 15,
                            ...(strat.client ? { extractorArgs: `youtube:player_client=${strat.client}` } : {})
                        });
                        const track = Array.isArray(info?.entries) ? info.entries[0] : info;
                        if (track?.title) exactTitle = track.title;
                    } catch (e) {}
                }
                break;
            }
        } catch (err) {
            lastError = err;
            if (fs.existsSync(outputPath)) {
                try { fs.unlinkSync(outputPath); } catch (e) {}
            }
        }
    }

    // Direct streaming URL fallback via FFmpeg if file download was blocked
    if (lastError && isYt) {
        for (const strat of [{ client: "android" }, { client: "ios" }, { client: undefined }]) {
            try {
                const streamUrl = await youtubedl(targetUrl, {
                    getUrl: true,
                    format: "bestaudio[ext=m4a]/bestaudio/best",
                    noPlaylist: true,
                    noWarnings: true,
                    noCheckCertificates: true,
                    geoBypass: true,
                    socketTimeout: 15,
                    ...(strat.client ? { extractorArgs: `youtube:player_client=${strat.client}` } : {})
                });

                const directUrl = typeof streamUrl === "string" ? streamUrl.trim().split(/[\r\n]+/)[0] : null;
                if (directUrl && directUrl.startsWith("http")) {
                    console.log(`[STREAM FALLBACK] Got direct audio stream for "${exactTitle}"`);
                    return {
                        filePath: null,
                        url: directUrl,
                        title: exactTitle || "Audio Stream",
                        isYouTube: true
                    };
                }
            } catch (e) {}
        }
    }

    // Alternative upload search fallback if original video was blocked/deleted
    if (lastError && exactTitle && exactTitle !== url && !exactTitle.includes("youtube.com")) {
        try {
            console.log(`[FALLBACK SEARCH] Searching alternative YouTube upload for "${exactTitle}"...`);
            await youtubedl(`ytsearch1:${exactTitle}`, {
                noPlaylist: true,
                format: "bestaudio[ext=m4a]/bestaudio/best",
                noWarnings: true,
                noCheckCertificates: true,
                geoBypass: true,
                extractorArgs: "youtube:player_client=android",
                output: outputPath,
                extractAudio: true,
                audioFormat: "mp3",
                audioQuality: "0",
                socketTimeout: 15,
                ...(ffmpegDir ? { ffmpegLocation: ffmpegDir } : {}),
                ...(cookieFile ? { cookies: cookieFile } : {})
            });

            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 2048) {
                lastError = null;
            }
        } catch (e) {}
    }

    // SoundCloud fallback as last resort (ONLY using real human song title, NEVER video ID)
    if (lastError) {
        const scSearchTerm = (!isHttpUrl(url)) 
            ? url 
            : ((exactTitle && exactTitle !== url && !extractYouTubeVideoId(exactTitle)) ? exactTitle : null);

        if (scSearchTerm) {
            try {
                console.log(`[SC FALLBACK] Searching SoundCloud for "${scSearchTerm}"...`);
                await youtubedl(`scsearch1:${scSearchTerm}`, {
                    noPlaylist: true,
                    format: "bestaudio/best",
                    noWarnings: true,
                    noCheckCertificates: true,
                    output: outputPath,
                    extractAudio: true,
                    audioFormat: "mp3",
                    audioQuality: "0",
                    socketTimeout: 15,
                    ...(ffmpegDir ? { ffmpegLocation: ffmpegDir } : {}),
                    ...(cookieFile ? { cookies: cookieFile } : {})
                });

                if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 2048) {
                    lastError = null;
                    exactTitle = `SoundCloud: ${scSearchTerm}`;
                }
            } catch (scErr) {
                console.warn(`[FALLBACK NOTE] ${scErr.message}`);
            }
        }
    }

    if (lastError) throw lastError;

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error("Failed to extract audio track");
    }

    return {
        filePath: outputPath,
        url: null,
        title: exactTitle,
        isYouTube: isYt
    };
}

function getPreparedAudio(url) {
    if (!audioCache.has(url)) {
        const audioPromise = getAudioUrl(url).catch(error => {
            audioCache.delete(url);
            throw error;
        });
        audioCache.set(url, audioPromise);
    }
    return audioCache.get(url);
}

async function retryPlayAudio(state, url, title, maxRetries = 3, syncMessageId, recoveryState = null) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await playAudio(state, url, title, syncMessageId, recoveryState);
            return true;
        } catch (error) {
            lastError = error;
            console.log(`[RETRY ${attempt}/${maxRetries}] Stream failed, retrying...`);
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                audioCache.delete(url);
            }
        }
    }
    throw lastError;
}

async function playAudio(state, url, title, syncMessageId, onlyState = null) {
    const audio = await getPreparedAudio(url);
    if (syncMessageId) await waitUntil(getSynchronizedStart(syncMessageId));
    
    const targetStates = onlyState ? [onlyState] : [...botStates];
    const startTime = Date.now();
    for (const botState of targetStates) {
        if (!botState.connection) continue;
        botState.currentUrl = url;
        botState.currentTitle = title || audio.title;
        botState.streamFailed = false;
        botState.suppressIdleRestart = false;
        botState.resource = createResource(botState, audio);
        botState.connection.subscribe(botState.audioPlayer);
        botState.audioPlayer.play(botState.resource);
        botState.playbackStartedAt = startTime;
    }
    console.log(`[NOW PLAYING] ${title || audio.title}`);
}

async function queueOrPlay(state, url, syncMessageId) {
    const canReplaceStoppedPlayback = playbackStopPending;
    playbackStopPending = false;
    if (!canReplaceStoppedPlayback && (playbackActive || [...botStates].some(botState => botState.resource || botState.audioPlayer.state.status !== AudioPlayerStatus.Idle))) {
        playbackQueue.push({ url, title: undefined });
        return false;
    }
    playbackActive = true;
    for (const botState of botStates) resetPlaybackPosition(botState);
    try {
        await retryPlayAudio(state, url, undefined, 3, syncMessageId);
        return true;
    } catch (error) {
        playbackActive = false;
        throw error;
    }
}

// ========== BOT STATE ==========
function createBotState(client, voiceGroup, botIndex) {
    const audioPlayer = createAudioPlayer();
    const state = {
        client,
        voiceGroup,
        botIndex,
        audioPlayer,
        connection: null,
        resource: null,
        ffmpeg: null,
        currentUrl: null,
        currentTitle: "Unknown",
        streamFailed: false,
        playbackOffset: 0,
        playbackStartedAt: null,
        get volume() { return sharedVolume; },
        set volume(value) { sharedVolume = value; },
        bassboost: false,
        bassboostGain: 0,
        dbGain: 0,
        suppressIdleRestart: false
    };
    botStates.add(state);

    audioPlayer.on(AudioPlayerStatus.Idle, (oldState) => {
        if (isShuttingDown) return;
        if (state.suppressIdleRestart) {
            state.suppressIdleRestart = false;
            return;
        }

        // Only handle track transition if player was actually playing or buffering before
        if (oldState?.status !== AudioPlayerStatus.Playing && oldState?.status !== AudioPlayerStatus.Buffering) {
            return;
        }
        
        if (botIndex !== PRIMARY_BOT_INDEX) return;

        for (const botState of botStates) {
            botState.resource = null;
        }
        playbackActive = false;
        const nextTrack = playbackQueue.shift();
        if (nextTrack && !isShuttingDown) {
            for (const botState of botStates) resetPlaybackPosition(botState);
            playbackActive = true;
            retryPlayAudio(state, nextTrack.url, nextTrack.title, 3).catch(error => {
                playbackActive = false;
                console.error(`[QUEUE ERROR] ${error.message}`);
            });
        }
    });

    if (botIndex === PRIMARY_BOT_INDEX) {
        audioPlayer.on(AudioPlayerStatus.Playing, () => {
            console.log(`[${state.client.user?.tag || "BOT"}] Audio player is sending audio`);
        });
        audioPlayer.on("error", error => console.error(`[SHARED PLAYER ERROR] ${error.message}`));
    }
    return state;
}

// ========== COMMAND HANDLER ==========
async function handleCommand(state, message) {
    if (message.author.bot) return;
    if (isShuttingDown) return;

    const validPrefixes = Array.from(new Set([prefix, "^", "."])).filter(Boolean);
    const matchedPrefix = validPrefixes.find(p => message.content.startsWith(p));
    if (!matchedPrefix) return;
    const usedPrefix = matchedPrefix;

    if (processedControlMessages.has(message.id)) return;
    processedControlMessages.add(message.id);
    setTimeout(() => processedControlMessages.delete(message.id), 30000).unref?.();

    const [command, ...args] = message.content.slice(usedPrefix.length).trim().split(/\s+/);
    if (!command) return;
    const lowerCommand = command.toLowerCase();
    const authorId = String(message.author.id).trim();
    const isOwner = ownerIds.has(authorId);
    const isTrusted = isOwner || trustedAdminIds.has(authorId);
    
    const botMember = message.guild?.members?.me;
    if (botMember && !message.channel.permissionsFor(botMember)?.has('ViewChannel')) {
        console.error(`[${state.client.user?.tag || "BOT"}] Cannot read #${message.channel?.name || "unknown"}`);
        return;
    }

    const commandReply = content => reply(message, content);

    // ========== OWNER ONLY COMMANDS ==========

    // !trust <user_id> - Add a user as trusted admin
    if (lowerCommand === "trust") {
        if (!isOwner) return commandReply("❌ Only bot owners can add trusted admins.");
        const targetUserId = args[0]?.replace(/[<@!>]/g, "").trim();
        if (!targetUserId || !/^\d{17,20}$/.test(targetUserId)) {
            return commandReply(`Usage: ${prefix}trust <user_id or @mention>`);
        }
        trustedAdminIds.add(targetUserId);
        saveConfig();
        return commandReply(`✅ User <@${targetUserId}> (\`${targetUserId}\`) is now added as a **Trusted Admin**!`);
    }

    // !untrust <user_id> - Remove a user from trusted admins
    if (lowerCommand === "untrust") {
        if (!isOwner) return commandReply("❌ Only bot owners can remove trusted admins.");
        const targetUserId = args[0]?.replace(/[<@!>]/g, "").trim();
        if (!targetUserId || !/^\d{17,20}$/.test(targetUserId)) {
            return commandReply(`Usage: ${prefix}untrust <user_id or @mention>`);
        }
        trustedAdminIds.delete(targetUserId);
        saveConfig();
        return commandReply(`✅ User <@${targetUserId}> (\`${targetUserId}\`) has been removed from **Trusted Admins**.`);
    }

    // !trusted - Show owner and trusted admins list
    if (lowerCommand === "trusted") {
        const ownerList = [...ownerIds].map(id => `• <@${id}> (\`${id}\`)`).join("\n") || "*None configured*";
        const trustedList = [...trustedAdminIds].map(id => `• <@${id}> (\`${id}\`)`).join("\n") || "*No trusted admins added yet (use `!trust <user_id>`)*";

        const msg = [
            `🛡️ **OWNERS & TRUSTED ADMINS LIST**`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `👑 **Bot Owners:**`,
            ownerList,
            ``,
            `🛡️ **Trusted Admins:**`,
            trustedList,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━`
        ].join("\n");
        return commandReply(msg);
    }

    // Authorization check for all other commands
    if (!isTrusted) {
        return commandReply("❌ You must be a bot Owner or Trusted Admin to use this bot.");
    }

    const voiceChannel = message.member?.voice.channel;
    
    try {
        // ========== BOT PROFILE (BP) MANAGEMENT COMMANDS ==========
        // Change banner, avatar, bio, username, and display name across server & bot cluster
        if (
            lowerCommand === "bp" ||
            lowerCommand === "botprofile" ||
            lowerCommand === "profile" ||
            lowerCommand === "setprofile" ||
            lowerCommand === "setavatar" ||
            lowerCommand === "avatar" ||
            lowerCommand === "setbanner" ||
            lowerCommand === "banner" ||
            lowerCommand === "setbio" ||
            lowerCommand === "bio" ||
            lowerCommand === "setusername" ||
            lowerCommand === "username" ||
            lowerCommand === "setname" ||
            lowerCommand === "name" ||
            lowerCommand === "setnick" ||
            lowerCommand === "nick"
        ) {
            let action = "info";
            let actionArgs = args;

            if (lowerCommand === "bp" || lowerCommand === "botprofile" || lowerCommand === "profile" || lowerCommand === "setprofile") {
                const sub = args[0]?.toLowerCase();
                if (sub) {
                    if (["avatar", "av", "icon", "pfp", "setavatar"].includes(sub)) action = "avatar";
                    else if (["banner", "bn", "setbanner", "cover"].includes(sub)) action = "banner";
                    else if (["bio", "about", "desc", "description", "setbio"].includes(sub)) action = "bio";
                    else if (["username", "user", "tag", "setusername"].includes(sub)) action = "username";
                    else if (["name", "displayname", "nick", "nickname", "globalname", "setname", "setnick"].includes(sub)) action = "name";
                    else if (["help", "info", "status", "show"].includes(sub)) action = "info";
                    else action = "unknown";
                    actionArgs = args.slice(1);
                } else {
                    action = "info";
                }
            } else if (lowerCommand === "setavatar" || lowerCommand === "avatar") {
                action = "avatar";
            } else if (lowerCommand === "setbanner" || lowerCommand === "banner") {
                action = "banner";
            } else if (lowerCommand === "setbio" || lowerCommand === "bio") {
                action = "bio";
            } else if (lowerCommand === "setusername" || lowerCommand === "username") {
                action = "username";
            } else if (lowerCommand === "setname" || lowerCommand === "name" || lowerCommand === "setnick" || lowerCommand === "nick") {
                action = "name";
            }

            // 1. AVATAR
            if (action === "avatar") {
                const attachmentUrl = message.attachments.first()?.url;
                const imageUrl = attachmentUrl || actionArgs.join(" ").trim();

                if (!imageUrl) {
                    return commandReply(`❌ **Missing image!** Please provide an image URL or upload/attach an image.\n• Usage: \`${prefix}bp avatar <URL>\` or upload an image with \`${prefix}bp avatar\``);
                }

                try {
                    await commandReply("⏳ **Downloading & applying new avatar across bot cluster...**");
                    const imgBuffer = await fetchImageBuffer(imageUrl);
                    if (!imgBuffer || imgBuffer.length === 0) {
                        return commandReply("❌ Failed to download avatar image from the provided link/attachment.");
                    }

                    const avatarDest = path.resolve(__dirname, "bot-avatar.png");
                    fs.writeFileSync(avatarDest, imgBuffer);
                    botAvatarPath = "bot-avatar.png";
                    saveConfig();

                    const base64Data = `data:image/png;base64,${imgBuffer.toString("base64")}`;
                    const results = [];
                    for (const bState of botStates) {
                        const botTag = bState.client.user?.tag || `Bot ${bState.botIndex}`;
                        let success = false;
                        try {
                            await bState.client.user.setAvatar(avatarDest);
                            success = true;
                        } catch (err) {
                            try {
                                await bState.client.rest.patch('/users/@me', { body: { avatar: base64Data } });
                                success = true;
                            } catch (restErr) {
                                results.push(`• **Bot ${bState.botIndex}** (${botTag}): ⚠️ ${err.message}`);
                            }
                        }
                        if (success) {
                            results.push(`• **Bot ${bState.botIndex}** (${botTag}): ✅ Avatar updated`);
                        }
                    }

                    const outMsg = [
                        `🖼️ **AVATAR UPDATE COMPLETED**`,
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                        ...results,
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                        `💾 Saved locally to \`bot-avatar.png\` and synced in \`config.json\`.`
                    ].join("\n");
                    return commandReply(outMsg);
                } catch (err) {
                    return commandReply(`❌ Failed to update avatar: ${err.message}`);
                }
            }

            // 2. BANNER
            if (action === "banner") {
                const attachmentUrl = message.attachments.first()?.url;
                const bannerUrl = attachmentUrl || actionArgs.join(" ").trim();

                if (!bannerUrl) {
                    return commandReply(`❌ **Missing banner image!** Please provide an image URL or upload/attach an image.\n• Usage: \`${prefix}bp banner <URL>\` or upload an image with \`${prefix}bp banner\``);
                }

                try {
                    await commandReply("⏳ **Downloading & applying new banner across bot cluster...**");
                    const imgBuffer = await fetchImageBuffer(bannerUrl);
                    if (!imgBuffer || imgBuffer.length === 0) {
                        return commandReply("❌ Failed to download banner image from the provided link/attachment.");
                    }

                    const bannerDest = path.resolve(__dirname, "bot-banner.png");
                    fs.writeFileSync(bannerDest, imgBuffer);
                    botBannerPath = "bot-banner.png";
                    saveConfig();

                    const base64Data = `data:image/png;base64,${imgBuffer.toString("base64")}`;
                    const results = [];
                    for (const bState of botStates) {
                        const botTag = bState.client.user?.tag || `Bot ${bState.botIndex}`;
                        let bannerSuccess = false;
                        try {
                            if (typeof bState.client.user.setBanner === "function") {
                                await bState.client.user.setBanner(bannerDest);
                                bannerSuccess = true;
                            }
                        } catch (e) {}

                        if (!bannerSuccess) {
                            try {
                                await bState.client.rest.patch('/users/@me', { body: { banner: base64Data } });
                                bannerSuccess = true;
                            } catch (restErr) {
                                try {
                                    await bState.client.rest.patch('/applications/@me', { body: { cover_image: base64Data } });
                                    bannerSuccess = true;
                                } catch (appErr) {}
                            }
                        }

                        if (bannerSuccess) {
                            results.push(`• **Bot ${bState.botIndex}** (${botTag}): ✅ Banner updated`);
                        } else {
                            results.push(`• **Bot ${bState.botIndex}** (${botTag}): ⚠️ Banner saved locally (Discord requires Nitro/App banner perms)`);
                        }
                    }

                    const outMsg = [
                        `🎨 **BANNER UPDATE COMPLETED**`,
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                        ...results,
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                        `💾 Saved locally to \`bot-banner.png\` and synced in \`config.json\`.`
                    ].join("\n");
                    return commandReply(outMsg);
                } catch (err) {
                    return commandReply(`❌ Failed to update banner: ${err.message}`);
                }
            }

            // 3. BIO / ABOUT ME
            if (action === "bio") {
                const newBio = actionArgs.join(" ").trim();
                if (!newBio) {
                    return commandReply(`❌ **Missing bio text!**\n• Usage: \`${prefix}bp bio <text>\`\n• Example: \`${prefix}bp bio 🐉 Official DRAGON RISE Swarm | High-Performance Audio\``);
                }

                try {
                    botBio = newBio;
                    saveConfig();

                    const results = [];
                    for (const bState of botStates) {
                        const botTag = bState.client.user?.tag || `Bot ${bState.botIndex}`;
                        let bioApplied = false;

                        try {
                            await bState.client.rest.patch('/users/@me', { body: { bio: newBio } });
                            bioApplied = true;
                        } catch (e) {}

                        try {
                            await bState.client.rest.patch('/applications/@me', { body: { description: newBio } });
                            bioApplied = true;
                        } catch (e) {}

                        try {
                            await bState.client.user.setPresence({
                                status: "online",
                                activities: [{ name: newBio.slice(0, 128), type: 4, state: newBio.slice(0, 128) }]
                            });
                            bioApplied = true;
                        } catch (e) {
                            try {
                                await bState.client.user.setActivity(newBio.slice(0, 128), { type: 0 });
                                bioApplied = true;
                            } catch (actErr) {}
                        }

                        results.push(`• **Bot ${bState.botIndex}** (${botTag}): ${bioApplied ? '✅ Bio & presence updated' : '⚠️ Bio saved to config'}`);
                    }

                    const outMsg = [
                        `📝 **BOT BIO / ABOUT ME UPDATED**`,
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                        `**New Bio:**`,
                        `>>> ${newBio}`,
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                        ...results,
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                        `💾 Updated in \`config.json\` and synced across bot instances.`
                    ].join("\n");
                    return commandReply(outMsg);
                } catch (err) {
                    return commandReply(`❌ Failed to update bio: ${err.message}`);
                }
            }

            // 4. USERNAME
            if (action === "username") {
                const newUsername = actionArgs.join(" ").trim();
                if (!newUsername) {
                    return commandReply(`❌ **Missing username!**\n• Usage: \`${prefix}bp username <new_username>\`\n• Example: \`${prefix}bp username DRAGON_RISE\``);
                }
                if (newUsername.length < 2 || newUsername.length > 32) {
                    return commandReply("❌ Username must be between 2 and 32 characters long.");
                }

                try {
                    botUsername = newUsername;
                    saveConfig();

                    const results = [];
                    for (const bState of botStates) {
                        const botTag = bState.client.user?.tag || `Bot ${bState.botIndex}`;
                        try {
                            await bState.client.user.setUsername(newUsername);
                            results.push(`• **Bot ${bState.botIndex}** (${botTag}): ✅ Username changed to \`${newUsername}\``);
                        } catch (err) {
                            results.push(`• **Bot ${bState.botIndex}** (${botTag}): ⚠️ ${err.message}`);
                        }
                    }

                    const outMsg = [
                        `🏷️ **BOT USERNAME UPDATE**`,
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                        `**Requested Username:** \`${newUsername}\``,
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                        ...results,
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                        `*(Note: Discord limits username updates to 2 times per hour)*`,
                        `💾 Updated in \`config.json\`.`
                    ].join("\n");
                    return commandReply(outMsg);
                } catch (err) {
                    return commandReply(`❌ Failed to update username: ${err.message}`);
                }
            }

            // 5. NAME / DISPLAY NAME / NICKNAME
            if (action === "name") {
                const newName = actionArgs.join(" ").trim();
                if (!newName) {
                    return commandReply(`❌ **Missing display name!**\n• Usage: \`${prefix}bp name <new_display_name>\`\n• Example: \`${prefix}bp name ⚡ 𝑫𝑹𝑨𝑮𝑶𝑵 𝑹𝑰𝑺𝑬\``);
                }

                try {
                    botName = newName;
                    saveConfig();

                    const results = [];
                    for (const bState of botStates) {
                        const botTag = bState.client.user?.tag || `Bot ${bState.botIndex}`;
                        try {
                            if (typeof bState.client.user.setGlobalName === "function") {
                                await bState.client.user.setGlobalName(newName).catch(() => null);
                            }
                        } catch (e) {
                            try {
                                await bState.client.rest.patch('/users/@me', { body: { global_name: newName } }).catch(() => null);
                            } catch (restErr) {}
                        }

                        let nickCount = 0;
                        for (const guild of bState.client.guilds.cache.values()) {
                            try {
                                const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
                                if (me) {
                                    await me.setNickname(newName).catch(() => null);
                                    nickCount++;
                                }
                            } catch (e) {}
                        }

                        results.push(`• **Bot ${bState.botIndex}** (${botTag}): ✅ Global name updated & nickname set in ${nickCount} server(s)`);
                    }

                    const outMsg = [
                        `👑 **BOT DISPLAY NAME & NICKNAME UPDATE**`,
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                        `**New Display Name:** \`${newName}\``,
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                        ...results,
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                        `💾 Updated in \`config.json\` and applied across all server nicknames.`
                    ].join("\n");
                    return commandReply(outMsg);
                } catch (err) {
                    return commandReply(`❌ Failed to update display name: ${err.message}`);
                }
            }

            // 6. INFO / STATUS / HELP OVERVIEW
            const avatarExists = fs.existsSync(path.resolve(__dirname, botAvatarPath));
            const bannerExists = fs.existsSync(path.resolve(__dirname, botBannerPath));

            const profileOverview = [
                `⚙️ **${botName} — BOT PROFILE CONFIGURATION (BP)**`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `👑 **Display Name:** \`${botName}\``,
                `🏷️ **Account Username:** \`${botUsername}\``,
                `📝 **Bio / About Me:** \`${botBio || "None configured"}\``,
                `🖼️ **Avatar File:** \`${botAvatarPath}\` ${avatarExists ? '✅' : '⚠️ (Missing file)'}`,
                `🎨 **Banner File:** \`${botBannerPath}\` ${bannerExists ? '✅' : '⚠️ (Missing file)'}`,
                `🤖 **Managed Swarm Bots:** \`${botStates.size}\` bot instance(s)`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `🛠️ **How to Modify Bot Profile:**`,
                `• \`${prefix}bp avatar <URL or upload image>\` — Change avatar across all bots`,
                `• \`${prefix}bp banner <URL or upload image>\` — Change banner across all bots`,
                `• \`${prefix}bp bio <text>\` — Change bot bio / about me`,
                `• \`${prefix}bp username <new_username>\` — Change account username`,
                `• \`${prefix}bp name <new_display_name>\` — Change global display name & server nicknames`,
                ``,
                `📌 **Direct Shortcuts:** \`${prefix}setavatar\`, \`${prefix}setbanner\`, \`${prefix}setbio\`, \`${prefix}setusername\`, \`${prefix}setname\``,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`
            ].join("\n");
            return commandReply(profileOverview);
        }

        // ========== SWARM & BOT CONTROLLER COMMANDS ==========

        // !say <message> - Make all bots repeat the message
        if (lowerCommand === "say") {
            const text = args.join(" ").trim();
            if (!text) return commandReply(`Usage: ${prefix}say <message>`);

            try {
                if (message.guild && message.channel.permissionsFor(message.guild.members.me)?.has('ManageMessages')) {
                    await message.delete().catch(() => null);
                }
            } catch (e) {}

            for (const bState of botStates) {
                try {
                    const targetCh = bState.client.channels.cache.get(message.channel.id);
                    if (targetCh && targetCh.isTextBased()) {
                        await targetCh.send(text).catch(() => null);
                    }
                } catch (e) {}
                await new Promise(r => setTimeout(r, 60));
            }
            return;
        }

        // !relay <channel_id_or_name> <message> - Send text to a specific text channel
        if (lowerCommand === "relay") {
            const channelTarget = args[0]?.replace(/[<#>]/g, "").trim();
            const text = args.slice(1).join(" ").trim();

            if (!channelTarget || !text) {
                return commandReply(`Usage: ${prefix}relay <channel_id_or_name> <message>`);
            }

            let targetChannel = null;
            for (const bState of botStates) {
                if (/^\d{17,20}$/.test(channelTarget)) {
                    targetChannel = bState.client.channels.cache.get(channelTarget) || await bState.client.channels.fetch(channelTarget).catch(() => null);
                }
                if (!targetChannel) {
                    targetChannel = bState.client.channels.cache.find(c => c.isTextBased() && c.name?.toLowerCase() === channelTarget.toLowerCase());
                }
                if (targetChannel) break;
            }

            if (!targetChannel) {
                return commandReply(`❌ Could not find channel \`${channelTarget}\` across any connected bots.`);
            }

            try {
                await targetChannel.send(text);
                return commandReply(`✅ Relayed message to <#${targetChannel.id}> in **${targetChannel.guild ? targetChannel.guild.name : 'Direct Channel'}**!`);
            } catch (e) {
                return commandReply(`❌ Failed to relay message to <#${targetChannel.id}>: ${e.message}`);
            }
        }

        // !follow <target> - Make all bots follow the target
        if (lowerCommand === "follow") {
            const targetArg = args[0]?.toLowerCase();

            if (targetArg === "stop" || targetArg === "off" || targetArg === "none" || targetArg === "cancel") {
                followState.active = false;
                followState.targetUserId = null;
                followState.targetTag = null;
                return commandReply("🛑 **Voice Follow Mode Disabled.** Bots will stay in their current channel.");
            }

            let targetUserId = args[0] ? args[0].replace(/[<@!>]/g, "").trim() : message.author.id;
            let targetUser = null;

            for (const bState of botStates) {
                targetUser = bState.client.users.cache.get(targetUserId) || await bState.client.users.fetch(targetUserId).catch(() => null);
                if (targetUser) break;
            }

            if (!targetUser) {
                return commandReply(`❌ Could not find user with ID / mention \`${args[0]}\`.`);
            }

            followState.active = true;
            followState.targetUserId = targetUser.id;
            followState.targetTag = targetUser.tag || targetUser.username;

            let userVoiceChannel = null;
            for (const bState of botStates) {
                for (const guild of bState.client.guilds.cache.values()) {
                    const member = guild.members.cache.get(targetUser.id) || await guild.members.fetch(targetUser.id).catch(() => null);
                    if (member?.voice?.channel) {
                        userVoiceChannel = member.voice.channel;
                        break;
                    }
                }
                if (userVoiceChannel) break;
            }

            if (userVoiceChannel) {
                const botArray = Array.from(botStates);
                await Promise.allSettled(botArray.map(bState => connectBotToVoiceChannel(bState, userVoiceChannel)));
                return commandReply(`🎯 **Follow Mode Activated!** All bots joined **${userVoiceChannel.name}** and are now following **${followState.targetTag}** wherever they move!`);
            } else {
                return commandReply(`🎯 **Follow Mode Activated!** All bots are now following **${followState.targetTag}**. When they join a voice channel, all bots will automatically follow!`);
            }
        }

        // !stop - Make all bots stop their current action
        if (lowerCommand === "stop") {
            playbackQueue.length = 0;
            playbackActive = false;
            playbackStopPending = true;
            try {
                const player = lavalinkClient?.getPlayer(message.guild.id);
                if (player) player.stop();
            } catch (e) {}
            for (const botState of botStates) {
                botState.suppressIdleRestart = true;
                botState.currentUrl = null;
                botState.currentTitle = "Unknown";
                resetPlaybackPosition(botState);
                try {
                    botState.audioPlayer.stop(true);
                } catch (e) {}
                stopActiveFfmpeg(botState);
                botState.resource = null;
            }

            const stoppedSpam = stopAllSpam();
            const stoppedDm = stopAllDmSpam();
            const wasFollowing = followState.active;
            followState.active = false;
            followState.targetUserId = null;
            followState.targetTag = null;

            return commandReply(`⏹️ **All Bot Actions Stopped Across All Bots!**\n• Music playback stopped & queue cleared\n• ${stoppedSpam} channel spam task(s) cancelled\n• ${stoppedDm} DM spam task(s) cancelled${wasFollowing ? '\n• Voice follow mode disabled' : ''}`);
        }

        // !stopspam / !stop_spam - Stop normal channel spam actions
        if (lowerCommand === "stopspam" || lowerCommand === "stop_spam") {
            const count = stopAllSpam();
            return commandReply(`🛑 **Stopped all channel spam actions.** (${count} active task(s) cancelled)`);
        }

        // !stopdm / !stop_dm - Stop DM spam actions
        if (lowerCommand === "stopdm" || lowerCommand === "stop_dm") {
            const count = stopAllDmSpam();
            return commandReply(`🛑 **Stopped all DM spam actions.** (${count} active task(s) cancelled)`);
        }

        // !jump - Make all bots perform a jump action
        if (lowerCommand === "jump") {
            const connectedBots = Array.from(botStates).filter(b => b.connection);
            if (connectedBots.length > 0) {
                for (const bState of connectedBots) {
                    try {
                        const channelId = bState.connection.joinConfig?.channelId;
                        const guildId = bState.connection.joinConfig?.guildId;
                        const targetGuild = bState.client.guilds.cache.get(guildId);
                        const targetChannel = targetGuild?.channels.cache.get(channelId);
                        if (targetChannel) {
                            bState.connection.rejoin({
                                channelId: targetChannel.id,
                                selfDeaf: false,
                                selfMute: false
                            });
                        }
                    } catch (e) {}
                }
                return commandReply(`🦘💨 **JUMP!** All ${connectedBots.length} connected bot(s) executed the voice channel jump!`);
            } else {
                return commandReply(`🦘💨 **JUMP!** All ${botStates.size} bot(s) performed the jump action!`);
            }
        }

        // !spam <count> <message> - Make all bots spam messages
        if (lowerCommand === "spam") {
            const count = parseInt(args[0], 10);
            const text = args.slice(1).join(" ").trim();
            if (!count || isNaN(count) || count < 1 || count > 500) {
                return commandReply(`Usage: ${prefix}spam <count (1-500)> <message>`);
            }
            if (!text) {
                return commandReply(`Usage: ${prefix}spam ${count} <message>`);
            }

            const taskId = ++spamTaskIdCounter;
            const task = { id: taskId, cancelled: false, channelId: message.channel.id };
            activeSpamTasks.set(taskId, task);

            await commandReply(`⚡ Started spamming **${count}** messages across **${botStates.size}** bot(s)! Use \`${prefix}stopspam\` or \`${prefix}stop\` to cancel.`);

            const botList = Array.from(botStates);
            (async () => {
                try {
                    for (let i = 0; i < count; i++) {
                        if (task.cancelled || isShuttingDown) break;
                        for (const bState of botList) {
                            if (task.cancelled || isShuttingDown) break;
                            try {
                                const targetCh = bState.client.channels.cache.get(message.channel.id);
                                if (targetCh && targetCh.isTextBased()) {
                                    await targetCh.send(text).catch(() => null);
                                }
                            } catch (e) {}
                            await new Promise(r => setTimeout(r, 150));
                        }
                        if (task.cancelled || isShuttingDown) break;
                        await new Promise(r => setTimeout(r, 200));
                    }
                } finally {
                    activeSpamTasks.delete(taskId);
                }
            })();
            return;
        }

        // !dmspam <user_id> <count> <message> - Send a personal DM to a user a set number of times
        if (lowerCommand === "dmspam") {
            const rawTarget = args[0];
            const targetUserId = rawTarget?.replace(/[<@!>]/g, "").trim();
            const count = parseInt(args[1], 10);
            const text = args.slice(2).join(" ").trim();

            if (!targetUserId || !/^\d{17,20}$/.test(targetUserId) || !count || isNaN(count) || count < 1 || count > 200 || !text) {
                return commandReply(`Usage: ${prefix}dmspam <user_id or @mention> <count (1-200)> <message>`);
            }

            let targetUser = null;
            for (const bState of botStates) {
                try {
                    targetUser = bState.client.users.cache.get(targetUserId) || await bState.client.users.fetch(targetUserId).catch(() => null);
                    if (targetUser) break;
                } catch (e) {}
            }

            if (!targetUser) {
                return commandReply(`❌ Could not find user with ID \`${targetUserId}\`.`);
            }

            const taskId = ++spamTaskIdCounter;
            const task = { id: taskId, cancelled: false, targetUserId };
            activeDmSpamTasks.set(taskId, task);

            await commandReply(`📨 Started DM spam of **${count}** message(s) to **${targetUser.tag || targetUser.username}** (\`${targetUserId}\`)! Use \`${prefix}stopdm\` or \`${prefix}stop\` to cancel.`);

            const botList = Array.from(botStates);
            (async () => {
                try {
                    for (let i = 0; i < count; i++) {
                        if (task.cancelled || isShuttingDown) break;
                        const bState = botList[i % botList.length];
                        try {
                            const u = await bState.client.users.fetch(targetUserId).catch(() => null);
                            if (u) {
                                await u.send(text);
                            }
                        } catch (e) {
                            console.warn(`[DMSPAM BOT ${bState.botIndex}] DM error:`, e.message);
                        }
                        await new Promise(r => setTimeout(r, 400));
                    }
                } finally {
                    activeDmSpamTasks.delete(taskId);
                }
            })();
            return;
        }

        // ========== VOICE & MUSIC COMMANDS ==========

        // !join / !leave - Join or leave a voice channel
        if (lowerCommand === "join") {
            let targetVoiceChannel = voiceChannel;
            if (args[0]) {
                const targetChannelId = args[0].replace(/[<#>]/g, "");
                for (const bState of botStates) {
                    targetVoiceChannel = bState.client.channels.cache.get(targetChannelId) || bState.client.channels.cache.find(c => c.isVoiceBased() && c.name?.toLowerCase() === args.join(" ").toLowerCase());
                    if (targetVoiceChannel) break;
                }
            }

            if (!targetVoiceChannel) return commandReply("Join a voice channel first or specify a valid voice channel ID/name.");

            // Connect all bots simultaneously in parallel!
            const { joinedCount, errors } = await connectAllBotsToVoiceChannel(targetVoiceChannel);

            if (joinedCount === 0) {
                return commandReply(`❌ No bots could join:\n${errors.slice(0, 5).join("\n")}`);
            }
            if (errors.length > 0) {
                return commandReply(`✅ Joined **${targetVoiceChannel.name}** (${joinedCount}/${botStates.size} bot(s) connected).\n⚠️ ${errors.length} bot(s) could not join.`);
            }
            return commandReply(`✅ All ${joinedCount} bot(s) joined **${targetVoiceChannel.name}** instantly!`);
        }

        if (lowerCommand === "leave" || lowerCommand === "dc") {
            try {
                const player = lavalinkClient?.getPlayer(message.guild.id);
                if (player) player.destroy();
            } catch (e) {}
            for (const botState of botStates) {
                botState.audioPlayer.stop();
                stopActiveFfmpeg(botState);
                botState.resource = null;
            }
            playbackActive = false;
            playbackQueue.length = 0;
            destroyAllConnections(message.guild.id);
            return commandReply("Disconnected from voice.");
        }

        // !play <song or URL> - Play or queue music (Lavalink + Direct Swarm fallback)
        // !play <song, URL, MP4, recording, attachment> - Play or queue music across the 31-bot swarm
        if (["play", "p", "playfile", "pf", "playmp4", "record", "rec"].includes(lowerCommand)) {
            if (processedPlayMessages.has(message.id)) return;
            processedPlayMessages.add(message.id);
            setTimeout(() => processedPlayMessages.delete(message.id), 30000).unref?.();

            if (!voiceChannel) {
                processedPlayMessages.delete(message.id);
                return commandReply("Join a voice channel first.");
            }

            // Check attachments in the current message
            const currentAttachments = [...message.attachments.values()]
                .filter(isAudioAttachment)
                .map(a => a.url);

            // Check attachments in replied-to message (if replying to a video, MP4, voice note, or recording)
            let refAttachments = [];
            if (message.reference?.messageId) {
                try {
                    const refMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
                    if (refMsg && refMsg.attachments?.size > 0) {
                        refAttachments = [...refMsg.attachments.values()]
                            .filter(isAudioAttachment)
                            .map(a => a.url);
                    }
                } catch (e) {}
            }

            const allAttachmentUrls = [...currentAttachments, ...refAttachments];
            const searchInput = args.join(" ").trim().replace(/^[<"']|[>"']$/g, "").trim();
            const query = allAttachmentUrls[0] || searchInput;

            if (!query) {
                processedPlayMessages.delete(message.id);
                return commandReply(`Usage: ${prefix}play <song title, YouTube URL, direct MP4 link, or attach/reply to an MP4/recording>`);
            }

            const isDirectMedia = isDirectAudioUrl(query) || isDiscordAttachmentUrl(query) || allAttachmentUrls.length > 0;
            const isYt = !isDirectMedia && isYouTubeUrl(query);
            const normalizedQuery = isYt ? normalizeYouTubeUrl(query) : query;

            // 1. LAVALINK ENGINE (PRIMARY - Plays directly via Lavalink node, bypassing YouTube bot blocks & DRM)
            if (lavalinkClient && (lavalinkClient.connected || lavalinkClient.sessionId) && allAttachmentUrls.length === 0) {
                try {
                    const primaryBot = [...botStates].find(b => b.botIndex === PRIMARY_BOT_INDEX) || state;
                    console.log(`[LAVALINK] 🔍 Searching for "${normalizedQuery}" on ${lavalinkClient.currentNode?.host || 'node'}...`);
                    const searchRes = await lavalinkClient.search(normalizedQuery);

                    if (searchRes && searchRes.tracks && searchRes.tracks.length > 0) {
                        // Cleanly detach primary bot's @discordjs/voice adapter if previously attached
                        if (primaryBot.connection) {
                            try { primaryBot.connection.destroy(); } catch (e) {}
                            primaryBot.connection = null;
                        }

                        // Connect only secondary swarm bots in background, leaving primaryBot dedicated to Lavalink
                        const secondaryBots = [...botStates].filter(b => b.botIndex !== PRIMARY_BOT_INDEX);
                        Promise.allSettled(secondaryBots.map(b => connectBotToVoiceChannel(b, voiceChannel))).catch(() => {});

                        const player = lavalinkClient.createPlayer(
                            message.guild.id,
                            voiceChannel.id,
                            message.channel.id,
                            primaryBot.client
                        );

                        await player.connect();

                        if (searchRes.loadType === "PLAYLIST_LOADED") {
                            const firstTrack = searchRes.tracks[0];
                            const remainingTracks = searchRes.tracks.slice(1);
                            player.queue.push(...remainingTracks);
                            if (!player.playing && !player.current) {
                                await player.play(firstTrack);
                                return commandReply(`▶️ **Now Playing (Playlist):** **${firstTrack.title}** (${searchRes.tracks.length} track(s) loaded from *${searchRes.playlist?.name || 'Playlist'}*)`);
                            } else {
                                return commandReply(`✅ **Added ${searchRes.tracks.length} track(s)** to queue from playlist **${searchRes.playlist?.name || 'Playlist'}**`);
                            }
                        } else {
                            const track = searchRes.tracks[0];
                            if (!player.playing && !player.current) {
                                await player.play(track);
                                return commandReply(`▶️ **Now Playing (Lavalink):** **${track.title}** (\`${track.author || 'Artist'}\`)`);
                            } else {
                                player.queue.push(track);
                                return commandReply(`✅ **Added to Queue (Lavalink):** **${track.title}** (#${player.queue.length})`);
                            }
                        }
                    } else {
                        console.warn(`[LAVALINK] No tracks found for "${normalizedQuery}", falling back to direct audio stream...`);
                    }
                } catch (lavaErr) {
                    console.warn(`[LAVALINK PLAY ERROR] ${lavaErr.message}, falling back to direct audio stream...`);
                }
            }

            // 2. SWARM DIRECT AUDIO ENGINE (FALLBACK / DIRECT ATTACHMENTS)
            const { joinedCount, errors: connectionErrors } = await connectAllBotsToVoiceChannel(voiceChannel);
            const connectedStates = Array.from(botStates).filter(botState => botState.connection);
            if (connectedStates.length === 0) {
                processedPlayMessages.delete(message.id);
                console.error(`[PLAY VOICE ERROR] ${connectionErrors.join(" | ")}`);
                return commandReply(`Bots could not join voice: ${connectionErrors[0] || 'Unknown error'}`);
            }
            
            if (!state.connection) {
                const connectedState = [...botStates].find(botState => botState.connection);
                if (!connectedState) {
                    processedPlayMessages.delete(message.id);
                    return commandReply("Use `join` first.");
                }
                state = connectedState;
            }
            
            let urls = [];
            if (allAttachmentUrls.length > 0) {
                urls = allAttachmentUrls;
            } else if (isYt || isHttpUrl(searchInput)) {
                urls = [normalizedQuery];
            } else {
                urls = [query];
            }
            
            let started = false;
            let firstTitle = null;
            for (const url of urls) {
                try {
                    const audio = await getPreparedAudio(url);
                    if (!firstTitle) firstTitle = audio.title;
                    started = await queueOrPlay(state, url, started ? undefined : message.id) || started;
                } catch (error) {
                    console.error(`[PLAY ERROR] ${error.message}`);
                    if (!started) return commandReply(`Failed to play: ${error.message}`);
                }
            }
            return commandReply(started ? `▶️ Playing: **${firstTitle || query}**` : `✅ Added to queue: **${firstTitle || query}**`);
        }
        
        // !pause / !resume / !skip - Control playback
        if (lowerCommand === "pause") {
            try {
                const player = lavalinkClient?.getPlayer(message.guild.id);
                if (player) player.pause(true);
            } catch (e) {}
            for (const botState of botStates) botState.audioPlayer.pause();
            return commandReply("⏸️ Playback paused.");
        }
        
        if (lowerCommand === "resume") {
            try {
                const player = lavalinkClient?.getPlayer(message.guild.id);
                if (player) player.pause(false);
            } catch (e) {}
            for (const botState of botStates) botState.audioPlayer.unpause();
            return commandReply("▶️ Playback resumed.");
        }

        if (lowerCommand === "skip" || lowerCommand === "next") {
            try {
                const player = lavalinkClient?.getPlayer(message.guild.id);
                if (player && (player.playing || player.current || player.queue.length > 0)) {
                    if (player.queue.length > 0) {
                        const nextTrack = player.queue.shift();
                        await player.play(nextTrack);
                        return commandReply(`⏭️ Skipped! Now playing: **${nextTrack.title}** (\`${nextTrack.author || 'Artist'}\`)`);
                    } else {
                        await player.stop();
                        return commandReply("⏭️ Skipped! Queue is empty.");
                    }
                }
            } catch (e) {}
            const nextTrack = playbackQueue.shift();
            if (nextTrack) {
                for (const botState of botStates) {
                    botState.suppressIdleRestart = true;
                    try {
                        botState.audioPlayer.stop(true);
                    } catch (e) {}
                    stopActiveFfmpeg(botState);
                    botState.resource = null;
                    resetPlaybackPosition(botState);
                }
                playbackActive = true;
                await retryPlayAudio(state, nextTrack.url, nextTrack.title, 3);
                return commandReply(`⏭️ Skipped! Now playing: **${nextTrack.title || nextTrack.url}**`);
            } else {
                for (const botState of botStates) {
                    botState.suppressIdleRestart = true;
                    try {
                        botState.audioPlayer.stop(true);
                    } catch (e) {}
                    stopActiveFfmpeg(botState);
                    botState.resource = null;
                    botState.currentUrl = null;
                    botState.currentTitle = "Unknown";
                }
                playbackActive = false;
                return commandReply("⏭️ Skipped! Queue is empty.");
            }
        }

        // !queue / !music - Show music status
        if (lowerCommand === "queue" || lowerCommand === "music" || lowerCommand === "np") {
            const lavaPlayer = lavalinkClient?.getPlayer(message.guild.id);
            if (lavaPlayer && (lavaPlayer.playing || lavaPlayer.current || lavaPlayer.queue.length > 0)) {
                const currentTrack = lavaPlayer.current ? `**${lavaPlayer.current.title}** (\`${lavaPlayer.current.author || 'Artist'}\`)` : "*Nothing playing*";
                const statusIcon = lavaPlayer.paused ? "⏸️ Paused" : (lavaPlayer.playing ? "▶️ Playing (Lavalink)" : "⏹️ Idle");

                let queueText = "";
                if (lavaPlayer.queue.length > 0) {
                    queueText = lavaPlayer.queue.slice(0, 10).map((t, idx) => `\`${idx + 1}.\` ${t.title || 'Track'} (\`${t.author || 'Artist'}\`)`).join("\n");
                    if (lavaPlayer.queue.length > 10) queueText += `\n*...and ${lavaPlayer.queue.length - 10} more*`;
                } else {
                    queueText = "*Queue is currently empty.*";
                }

                const volPct = lavaPlayer.volume || 100;
                const connectedCount = Array.from(botStates).filter(b => b.connection).length + (lavaPlayer ? 1 : 0);

                const embedLike = [
                    `🎶 **LAVALINK MUSIC STATUS**`,
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                    `**Status:** ${statusIcon}`,
                    `**Now Playing:** ${currentTrack}`,
                    `**Audio Settings:** Volume: \`${volPct}%\` | Node: \`${lavalinkClient?.currentNode?.host || 'Active'}\``,
                    `**Bots in Voice:** \`${connectedCount}/${botStates.size}\``,
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                    `📋 **Upcoming Queue (${lavaPlayer.queue.length} track(s)):**`,
                    queueText
                ].join("\n");

                return commandReply(embedLike);
            }

            const primaryState = [...botStates][0];
            const currentTrack = primaryState?.currentTitle && primaryState.currentTitle !== "Unknown" ? primaryState.currentTitle : null;
            const isPlaying = playbackActive || primaryState?.audioPlayer.state.status === AudioPlayerStatus.Playing;
            const isPaused = primaryState?.audioPlayer.state.status === AudioPlayerStatus.Paused;
            const statusIcon = isPlaying ? "▶️ Playing" : isPaused ? "⏸️ Paused" : "⏹️ Idle";

            let queueText = "";
            if (playbackQueue.length > 0) {
                queueText = playbackQueue.slice(0, 10).map((t, idx) => `\`${idx + 1}.\` ${t.title || t.url}`).join("\n");
                if (playbackQueue.length > 10) queueText += `\n*...and ${playbackQueue.length - 10} more*`;
            } else {
                queueText = "*Queue is currently empty.*";
            }

            const volPct = Math.round((sharedVolume || 1) * 100);
            const gainDb = primaryState?.dbGain || 0;
            const bassVal = primaryState?.bassboost ? (primaryState.bassboostGain || 0) : 0;
            const connectedCount = Array.from(botStates).filter(b => b.connection).length;

            const embedLike = [
                `🎶 **MUSIC & PLAYBACK STATUS**`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `**Status:** ${statusIcon}`,
                `**Now Playing:** ${currentTrack ? `**${currentTrack}**` : "*Nothing playing*"}`,
                `**Audio Settings:** Volume: \`${volPct}%\` | Gain: \`+${gainDb}dB\` | Bass: \`+${bassVal}dB\``,
                `**Connected Bots in Voice:** \`${connectedCount}/${botStates.size}\``,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `📋 **Upcoming Queue (${playbackQueue.length} track(s)):**`,
                queueText
            ].join("\n");

            return commandReply(embedLike);
        }

        // !volume <0-10000> / !gain <0-60> / !bass <0-60> / !boost / !earrape - Adjust audio
        if (lowerCommand === "volume" || lowerCommand === "v" || lowerCommand === "vol") {
            const raw = args[0];
            if (!raw) return commandReply(`Volume: ${Math.round((sharedVolume || 1) * 100)}%`);
            
            const value = Number(raw);
            if (!Number.isFinite(value) || value < 0 || value > 10000) {
                return commandReply(`Usage: ${prefix}volume <0-10000>`);
            }
            updateAllBotStates(botState => { botState.volume = value / 100; });
            updateAllBotStates(updateResourceVolume);
            try {
                const player = lavalinkClient?.getPlayer(message.guild.id);
                if (player) player.setVolume(value);
            } catch (e) {}
            return commandReply(`Volume: ${value}%`);
        }

        if (lowerCommand === "gain" || lowerCommand === "g") {
            const raw = args[0]?.replace(/db$/i, "");
            if (!raw) {
                const currentGain = [...botStates][0]?.dbGain || 0;
                return commandReply(`Gain: +${currentGain}dB`);
            }
            const value = Number(raw);
            if (!Number.isFinite(value) || value < 0 || value > 60) {
                return commandReply(`Usage: ${prefix}gain <0-60>`);
            }
            updateAllBotStates(botState => {
                botState.dbGain = value;
            });
            updateAllBotStates(updateResourceVolume);
            return commandReply(`Gain: +${value}dB`);
        }

        if (lowerCommand === "bass" || lowerCommand === "bassboost" || lowerCommand === "bb") {
            const raw = args[0]?.replace(/db$/i, "");
            if (!raw) {
                const currentBass = [...botStates][0]?.bassboost ? ([...botStates][0]?.bassboostGain || 12) : 0;
                return commandReply(`Bass: +${currentBass}dB`);
            }
            const value = Number(raw);
            if (!Number.isFinite(value) || value < 0 || value > 60) {
                return commandReply(`Usage: ${prefix}bass <0-60>`);
            }
            updateAllBotStates(botState => {
                botState.bassboostGain = value;
                botState.bassboost = value > 0;
            });
            updateAllBotStates(updateResourceVolume);
            return commandReply(`Bass: +${value}dB`);
        }

        // !boost / !maxvol / !earrape / !loud - Extreme loudness presets
        if (lowerCommand === "boost" || lowerCommand === "maxvol" || lowerCommand === "earrape" || lowerCommand === "loud") {
            const mode = (lowerCommand === "earrape" ? "earrape" : (lowerCommand === "maxvol" ? "max" : (args[0]?.toLowerCase() || "max")));
            
            if (mode === "reset" || mode === "off" || mode === "normal" || mode === "clean") {
                updateAllBotStates(botState => {
                    botState.volume = 1;
                    botState.dbGain = 0;
                    botState.bassboostGain = 0;
                    botState.bassboost = false;
                });
                updateAllBotStates(updateResourceVolume);
                return commandReply("Boost: Reset (100%)");
            } else if (mode === "earrape" || mode === "extreme" || mode === "insane") {
                updateAllBotStates(botState => {
                    botState.volume = 100;
                    botState.dbGain = 50;
                    botState.bassboostGain = 40;
                    botState.bassboost = true;
                });
                updateAllBotStates(updateResourceVolume);
                return commandReply("Boost: Earrape (10,000%)");
            } else if (mode === "high" || mode === "hard") {
                updateAllBotStates(botState => {
                    botState.volume = 10;
                    botState.dbGain = 20;
                    botState.bassboostGain = 18;
                    botState.bassboost = true;
                });
                updateAllBotStates(updateResourceVolume);
                return commandReply("Boost: High (1,000%)");
            } else if (mode === "med" || mode === "medium") {
                updateAllBotStates(botState => {
                    botState.volume = 5;
                    botState.dbGain = 12;
                    botState.bassboostGain = 10;
                    botState.bassboost = true;
                });
                updateAllBotStates(updateResourceVolume);
                return commandReply("Boost: Medium (500%)");
            } else { // default 'max'
                updateAllBotStates(botState => {
                    botState.volume = 25;
                    botState.dbGain = 30;
                    botState.bassboostGain = 24;
                    botState.bassboost = true;
                });
                updateAllBotStates(updateResourceVolume);
                return commandReply("Boost: Max (2,500%)");
            }
        }

        // ========== SYSTEM & STATUS COMMANDS ==========

        // !status - Show bot connection status
        if (lowerCommand === "status") {
            const totalBots = botStates.size;
            const onlineBots = Array.from(botStates).filter(b => b.client?.ws?.status === 0);
            const connectedVoiceBots = Array.from(botStates).filter(b => b.connection);

            const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
            const totalMem = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
            const uptimeSec = Math.floor(process.uptime());
            const uptimeStr = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m ${uptimeSec % 60}s`;

            let botLines = [];
            for (const bState of botStates) {
                const tag = bState.client.user?.tag || `Bot-${bState.botIndex}`;
                const ping = bState.client.ws?.ping >= 0 ? `${bState.client.ws.ping}ms` : "N/A";
                const isOnline = bState.client.ws?.status === 0;
                let vcName = "None";
                if (bState.connection) {
                    const chId = bState.connection.joinConfig?.channelId;
                    const guildId = bState.connection.joinConfig?.guildId;
                    const guild = bState.client.guilds.cache.get(guildId);
                    const ch = guild?.channels.cache.get(chId);
                    vcName = ch?.name || "Connected";
                }
                botLines.push(`• **Bot ${bState.botIndex}** (${tag}): ${isOnline ? "🟢 Online" : "🔴 Offline"} | Ping: \`${ping}\` | Voice: \`${vcName}\` | Guilds: \`${bState.client.guilds.cache.size}\``);
            }

            const msg = [
                `🤖 **BOT CLUSTER & CONNECTION STATUS**`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `**Active Bots:** \`${onlineBots.length}/${totalBots} Online\``,
                `**Voice Connected:** \`${connectedVoiceBots.length}/${totalBots} Bots in Voice\``,
                `**System Uptime:** \`${uptimeStr}\``,
                `**RAM Usage:** \`${memUsage} MB\` (Heap) / \`${totalMem} MB\` (RSS)`,
                `**Node.js:** \`${process.version}\` | **Platform:** \`${process.platform}\``,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `📋 **Bot Instances:**`,
                ...botLines.slice(0, 15)
            ].join("\n");

            return commandReply(msg);
        }

        // !botinfo - Show bot details and current runtime status
        if (lowerCommand === "botinfo") {
            const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
            const uptimeSec = Math.floor(process.uptime());
            const uptimeStr = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m ${uptimeSec % 60}s`;
            const totalGuilds = new Set([...botStates].flatMap(b => Array.from(b.client.guilds.cache.keys()))).size;
            const connectedVoiceCount = Array.from(botStates).filter(b => b.connection).length;
            const primaryBot = [...botStates][0];

            const infoMsg = [
                `⚡ **${botName} — SYSTEM & RUNTIME DETAILS**`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `👑 **Bot Identity & Profile:**`,
                `• **Display Name:** \`${botName}\``,
                `• **Default Username:** \`${botUsername}\``,
                `• **Bio / About:** \`${botBio || "None configured"}\``,
                `• **Avatar File:** \`${botAvatarPath}\``,
                `• **Banner File:** \`${botBannerPath}\``,
                `• **Command Prefix:** \`${prefix}\``,
                `• **Total Bot Instances:** \`${botStates.size}\` account(s) connected`,
                `• **Total Servers:** \`${totalGuilds}\` server(s)`,
                `• **Bots in Voice:** \`${connectedVoiceCount}/${botStates.size}\``,
                ``,
                `🛡️ **Access Control:**`,
                `• **Owners Configured:** \`${ownerIds.size}\``,
                `• **Trusted Admins:** \`${trustedAdminIds.size}\``,
                ``,
                `⚙️ **Active Tasks & Automation:**`,
                `• **Follow Mode:** ${followState.active ? `🟢 Active (Target: \`${followState.targetTag}\`)` : "🔴 Inactive"}`,
                `• **Channel Spam Tasks:** \`${activeSpamTasks.size}\` running`,
                `• **DM Spam Tasks:** \`${activeDmSpamTasks.size}\` running`,
                `• **Music Playback:** ${playbackActive ? `▶️ Playing (\`${primaryBot?.currentTitle || "Audio"}\`)` : "⏹️ Idle"}`,
                ``,
                `💻 **Host Environment:**`,
                `• **Uptime:** \`${uptimeStr}\``,
                `• **Memory (RAM):** \`${memUsage} MB\``,
                `• **Node.js:** \`${process.version}\``,
                `• **FFmpeg Engine:** \`${path.basename(ffmpegPath)}\``,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`
            ].join("\n");

            return commandReply(infoMsg);
        }

        // !help - Command list
        if (lowerCommand === "help") {
            const helpMsg = [
                `📖 **${botName} — COMMANDS LIST**`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `⚡ **Bot Profile & Customization (BP):**`,
                `• \`${prefix}bp\` - Show bot profile status and settings overview`,
                `• \`${prefix}bp avatar <URL or upload image>\` - Change bot avatar`,
                `• \`${prefix}bp banner <URL or upload image>\` - Change bot banner`,
                `• \`${prefix}bp bio <text>\` - Change bot bio / about me description`,
                `• \`${prefix}bp username <new_username>\` - Change bot username`,
                `• \`${prefix}bp name <new_display_name>\` - Change display name & server nicknames`,
                ``,
                `⚡ **Multi-Bot Swarm & Control:**`,
                `• \`${prefix}say <message>\` - Make all bots repeat the message`,
                `• \`${prefix}relay <channel_id_or_name> <message>\` - Send text to a specific text channel`,
                `• \`${prefix}follow <target|stop>\` - Make all bots follow the target across voice channels`,
                `• \`${prefix}stop\` - Make all bots stop their current action`,
                `• \`${prefix}stopspam\` / \`${prefix}stop_spam\` - Stop normal channel spam actions`,
                `• \`${prefix}stopdm\` / \`${prefix}stop_dm\` - Stop DM spam actions`,
                `• \`${prefix}jump\` - Make all bots perform a jump action`,
                `• \`${prefix}spam <count> <message>\` - Make all bots spam messages`,
                `• \`${prefix}dmspam <user_id> <count> <message>\` - Send a personal DM to a user a set number of times`,
                ``,
                `🎶 **Voice & Music Playback:**`,
                `• \`${prefix}join\` / \`${prefix}leave\` - Join or leave a voice channel`,
                `• \`${prefix}play <song or URL>\` - Play or queue music`,
                `• \`${prefix}pause\` / \`${prefix}resume\` / \`${prefix}skip\` - Control playback`,
                `• \`${prefix}queue\` / \`${prefix}music\` - Show music status`,
                `• \`${prefix}volume <0-1000>\` / \`${prefix}gain <0-24>\` / \`${prefix}bass <0-24>\` - Adjust audio`,
                ``,
                `🤖 **System & Status:**`,
                `• \`${prefix}status\` - Show bot connection status`,
                `• \`${prefix}botinfo\` - Show bot details and current runtime status`,
                ``,
                `👑 **Owner Only Commands:**`,
                `• \`${prefix}trust <user_id>\` - Add a user as trusted admin`,
                `• \`${prefix}untrust <user_id>\` - Remove a user from trusted admins`,
                `• \`${prefix}trusted\` - Show owner and trusted admins list`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`
            ].join("\n");
            return commandReply(helpMsg);
        }
        
    } catch (error) {
        const currentBotTag = state.client.user?.tag || "BOT";
        console.error(`[${currentBotTag}] ${prefix}${lowerCommand} failed: ${error.stack || error.message}`);
        return commandReply(`${currentBotTag}: ${prefix}${lowerCommand} failed: ${error.message}`);
    }
}

// ========== BOT STARTUP ==========
async function startBot(token, index) {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates
        ]
    });
    
    const state = createBotState(client, `bot-${index}`, index);
    
    if (index === PRIMARY_BOT_INDEX) {
        setupLavalink(client);
    }
    
    client.once(Events.ClientReady || "ready", async readyClient => {
        try {
            if (index === PRIMARY_BOT_INDEX && lavalinkClient) {
                try {
                    lavalinkClient.init(readyClient.user.id);
                } catch (e) {
                    console.warn("[LAVALINK] Init error:", e.message);
                }
            }
            if (typeof readyClient.user.setGlobalName === "function" && readyClient.user.globalName !== botName) {
                try {
                    await readyClient.user.setGlobalName(botName);
                } catch (e) {}
            }
            if (readyClient.user.username !== botUsername) {
                try {
                    await readyClient.user.setUsername(botUsername);
                } catch (error) {}
            }
            for (const guild of readyClient.guilds.cache.values()) {
                try {
                    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
                    if (me && me.nickname !== botName) {
                        await me.setNickname(botName).catch(() => null);
                    }
                } catch (e) {}
            }
            const avatarPath = path.resolve(__dirname, botAvatarPath);
            if (fs.existsSync(avatarPath)) {
                try {
                    await readyClient.user.setAvatar(avatarPath);
                } catch (error) {}
            }
            const bannerPath = path.resolve(__dirname, botBannerPath);
            if (fs.existsSync(bannerPath)) {
                try {
                    await readyClient.user.setBanner(bannerPath);
                } catch (error) {}
            }
            if (botBio) {
                try {
                    await readyClient.rest.patch('/users/@me', { body: { bio: botBio } }).catch(() => null);
                } catch (e) {}
                try {
                    await readyClient.rest.patch('/applications/@me', { body: { description: botBio } }).catch(() => null);
                } catch (e) {}
            }
            await readyClient.user.setPresence({ 
                status: "online", 
                activities: [{ name: botBio ? botBio.slice(0, 128) : `${prefix}help`, type: 0 }] 
            });
            console.log(`[BOT ${index}] ✅ Logged in as ${readyClient.user.tag}`);
        } catch (error) {
            console.error(`[BOT ${index}] Failed to set presence: ${error.message}`);
        }
    });
    
    client.on("messageCreate", message => handleCommand(state, message));
    client.on("raw", d => {
        if (lavalinkClient && (d.t === "VOICE_SERVER_UPDATE" || d.t === "VOICE_STATE_UPDATE")) {
            lavalinkClient.updateVoiceState(d);
        }
    });
    client.on("voiceStateUpdate", async (oldState, newState) => {
        if (followState.active && followState.targetUserId === newState.id) {
            if (newState.channelId && newState.channelId !== oldState.channelId) {
                if (index === PRIMARY_BOT_INDEX) {
                    console.log(`[FOLLOW] Target ${followState.targetTag || newState.id} moved to channel ${newState.channel?.name || newState.channelId}`);
                    const primaryGuild = state.client.guilds.cache.get(newState.guild.id);
                    const ch = primaryGuild?.channels.cache.get(newState.channelId) || newState.channel;
                    if (ch) {
                        await connectAllBotsToVoiceChannel(ch);
                    }
                }
            }
        }
    });
    client.on("error", error => console.error(`[BOT ${index}] Client error: ${error.message}`));
    client.on("rateLimit", info => {
        console.warn(`[BOT ${index}] Rate limited: ${info.timeout}ms - ${info.route}`);
    });
    
    try {
        await client.login(token);
        console.log(`[BOT ${index}] ✅ Login successful`);
        return client;
    } catch (error) {
        console.error(`[BOT ${index}] ❌ Login failed: ${error.message}`);
        throw error;
    }
}

async function startAllBots() {
    console.log('🚀 Starting Music & Swarm Bot System...');
    console.log(`📝 Found ${tokens.length} tokens`);
    
    if (tokens.length === 0) {
        console.error("❌ No bot tokens configured.");
        process.exit(1);
    }
    
    const validTokens = tokens.filter(t => t && t.length > 10);
    if (validTokens.length === 0) {
        console.error("❌ No valid tokens found!");
        process.exit(1);
    }
    
    for (let i = 0; i < validTokens.length; i++) {
        try {
            await startBot(validTokens[i], i + 1);
            if (i < validTokens.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            console.error(`[STARTUP ERROR BOT ${i + 1}] ${error.message}`);
        }
    }
    
    console.log(`✅ Bot system startup complete. ${botStates.size} bots online.`);
}

// ========== CLEANUP ==========
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    isShuttingDown = true;
    for (const botState of botStates) {
        try {
            botState.audioPlayer.stop();
            stopActiveFfmpeg(botState);
            if (botState.connection) {
                botState.connection.destroy();
            }
        } catch (e) {}
    }
    setTimeout(() => process.exit(0), 2000);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down (SIGTERM)...');
    isShuttingDown = true;
    for (const botState of botStates) {
        try {
            botState.audioPlayer.stop();
            stopActiveFfmpeg(botState);
            if (botState.connection) {
                botState.connection.destroy();
            }
        } catch (e) {}
    }
    setTimeout(() => process.exit(0), 2000);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
});

// ========== RAILWAY / CLOUD HEALTH CHECK SERVER ==========
const PORT = process.env.PORT;
if (PORT) {
    const http = require("http");
    const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(`DRAGON RISE Bot System is online. Active bots: ${botStates.size}`);
    });
    server.listen(PORT, "0.0.0.0", () => {
        console.log(`🌐 Health check server listening on port ${PORT}`);
    });
}

// ========== START ==========
startAllBots();
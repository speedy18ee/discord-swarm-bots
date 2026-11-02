const WebSocket = require("ws");
const axios = require("axios");

const DEFAULT_NODES = [
    {
        name: "Lava Lenin",
        host: "noi6.visihost.in",
        port: 25591,
        password: "ganahubkl",
        secure: false
    },
    {
        host: "nodelink-02.triniumhost.com",
        port: 443,
        password: "trinium",
        secure: true
    },
    {
        host: "lavalinkv4.serenetia.com",
        port: 443,
        password: "https://seretia.link/discord",
        secure: true
    },
    {
        host: "nodelink.triniumhost.com",
        port: 443,
        password: "free",
        secure: true
    },
    {
        host: "lavalink.jirayu.net",
        port: 443,
        password: "youshallnotpass",
        secure: true
    },
    {
        host: "lavalink-v4.triniumhost.com",
        port: 443,
        password: "free",
        secure: true
    },
    {
        host: "lava-v4.millohost.my.id",
        port: 443,
        password: "https://discord.gg/mjS5J2K3ep",
        secure: true
    }
];

class LavalinkClient {
    constructor(options = {}) {
        let configuredNodes = [];
        if (Array.isArray(options.nodes) && options.nodes.length > 0) {
            configuredNodes = options.nodes;
        } else if (options.host) {
            configuredNodes = [{
                host: options.host,
                port: options.port || 443,
                password: options.password || "free",
                secure: options.secure !== false
            }];
        } else {
            configuredNodes = DEFAULT_NODES;
        }

        this.nodes = configuredNodes.map(n => {
            let host = n.host;
            let port = n.port;
            if (n.url && !host) {
                const cleaned = String(n.url).replace(/^https?:\/\//, "").replace(/^wss?:\/\//, "");
                const parts = cleaned.split(":");
                host = parts[0];
                port = parts[1] ? parseInt(parts[1], 10) : 25591;
            }
            return {
                name: n.name || "Lavalink",
                host: host || "noi6.visihost.in",
                port: port || 25591,
                password: n.auth || n.password || "ganahubkl",
                secure: n.secure !== undefined ? Boolean(n.secure) : false
            };
        });
        this.currentNodeIndex = 0;
        this.clientId = options.clientId || null;
        this.clientName = options.clientName || "DRAGON-RISE-Swarm/1.0";
        this.socket = null;
        this.sessionId = null;
        this.connected = false;
        this.isV4 = true;
        this.players = new Map(); // guildId -> Player
        this.voiceStates = new Map(); // guildId -> { serverUpdate, stateUpdate }
        this.reconnectTimeout = null;
        this.isConnecting = false;
    }

    get currentNode() {
        if (!this.nodes || this.nodes.length === 0) {
            return DEFAULT_NODES[0];
        }
        return this.nodes[this.currentNodeIndex % this.nodes.length];
    }

    get httpUrl() {
        const n = this.currentNode;
        return `http${n.secure ? "s" : ""}://${n.host}:${n.port}`;
    }

    get wsUrl() {
        const n = this.currentNode;
        return `ws${n.secure ? "s" : ""}://${n.host}:${n.port}`;
    }

    get password() {
        return this.currentNode.password;
    }

    init(clientId) {
        if (clientId) this.clientId = clientId;
        if (this.clientId && this.clientId !== "0") {
            this.connect();
        }
    }

    switchToNextNode(reason) {
        const oldNode = this.currentNode;
        this.currentNodeIndex = (this.currentNodeIndex + 1) % this.nodes.length;
        const nextNode = this.currentNode;
        console.warn(`[LAVALINK] 🔄 Node [${oldNode.host}] notice: ${reason || 'unreachable'}. Failing over to [${nextNode.host}:${nextNode.port}]...`);
        this.connected = false;
        this.sessionId = null;
        this.scheduleReconnect(1500);
    }

    connect() {
        if (!this.clientId || this.clientId === "0") {
            return;
        }

        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const node = this.currentNode;
        const headers = {
            Authorization: node.password,
            "User-Id": String(this.clientId),
            "Client-Name": this.clientName,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LavalinkClient/1.0"
        };

        const targetWsUrl = `${this.wsUrl}/v4/websocket`;
        console.log(`[LAVALINK] 🔄 Connecting to node ${node.host}:${node.port} (v4)...`);
        this.isConnecting = true;

        try {
            if (this.socket) {
                this.socket.removeAllListeners();
                try { this.socket.close(); } catch (e) {}
                this.socket = null;
            }

            this.socket = new WebSocket(targetWsUrl, { 
                headers,
                handshakeTimeout: 8000
            });

            this.socket.on("open", () => {
                this.isConnecting = false;
                console.log(`[LAVALINK] 🌐 WebSocket connection opened to ${node.host}:${node.port}`);
            });

            this.socket.on("message", data => {
                try {
                    const payload = JSON.parse(data.toString());
                    this.handleMessage(payload);
                } catch (e) {
                    console.error("[LAVALINK] Parse error:", e.message);
                }
            });

            let failoverHandled = false;
            const triggerFailover = (reason) => {
                if (failoverHandled) return;
                failoverHandled = true;
                this.switchToNextNode(reason);
            };

            this.socket.on("close", (code, reason) => {
                this.isConnecting = false;
                const wasConnected = this.connected;
                this.connected = false;
                this.sessionId = null;
                console.warn(`[LAVALINK] ⚠️ Disconnected from ${node.host} (Code: ${code}).`);
                
                // If it failed immediately with error or abnormal code (e.g. 1006 / 403), switch node
                if (!wasConnected || code === 1006 || code === 4004 || code === 4001) {
                    triggerFailover(`Connection closed (${code})`);
                } else {
                    this.scheduleReconnect(5000);
                }
            });

            this.socket.on("error", err => {
                this.isConnecting = false;
                if (err.message.includes("401")) {
                    console.warn(`[LAVALINK] ❌ Node ${node.host}:${node.port} returned 401 Unauthorized! The Lavalink password (NODE_AUTH) was rejected.`);
                } else {
                    console.warn(`[LAVALINK] ⚠️ Node ${node.host} error: ${err.message}`);
                }
                
                if (err.message.includes("404") && this.isV4) {
                    this.isV4 = false;
                    console.log(`[LAVALINK] Trying Lavalink v3 protocol on ${node.host}...`);
                    this.connectV3(headers);
                } else {
                    // Try next node in pool immediately
                    triggerFailover(err.message);
                }
            });
        } catch (e) {
            this.isConnecting = false;
            console.error("[LAVALINK] Socket creation error:", e.message);
            this.switchToNextNode(e.message);
        }
    }

    connectV3(headers) {
        const node = this.currentNode;
        try {
            if (this.socket) {
                this.socket.removeAllListeners();
                try { this.socket.close(); } catch (e) { }
            }
            this.socket = new WebSocket(this.wsUrl, { headers, handshakeTimeout: 8000 });
            this.socket.on("open", () => {
                this.connected = true;
                console.log(`[LAVALINK] ✅ Connected to ${node.host}:${node.port} (v3)`);
            });
            this.socket.on("message", data => {
                try {
                    const payload = JSON.parse(data.toString());
                    this.handleMessage(payload);
                } catch (e) { }
            });
            this.socket.on("close", () => {
                this.connected = false;
                this.switchToNextNode("v3 close");
            });
            this.socket.on("error", err => {
                console.warn(`[LAVALINK v3] Note: ${err.message}`);
                this.switchToNextNode(err.message);
            });
        } catch (e) {
            this.switchToNextNode(e.message);
        }
    }

    scheduleReconnect(delay = 2000) {
        if (!this.clientId || this.clientId === "0") return;
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => this.connect(), delay);
    }

    handleMessage(payload) {
        if (payload.op === "ready") {
            this.sessionId = payload.sessionId;
            this.connected = true;
            this.isV4 = true;
            console.log(`[LAVALINK] ✅ Connected & Session Ready on ${this.currentNode.host}! (Session: ${this.sessionId})`);
            
            // Synchronize voice states of existing players
            for (const [guildId, state] of this.voiceStates.entries()) {
                if (state.serverUpdate && state.stateUpdate) {
                    this.sendVoiceUpdate(guildId, state).catch(() => {});
                }
            }
        } else if (payload.op === "event") {
            const player = this.players.get(payload.guildId);
            if (player) {
                if (payload.type === "TrackEndEvent") {
                    player.onTrackEnd(payload);
                } else if (payload.type === "TrackStartEvent") {
                    player.onTrackStart(payload);
                }
            }
        }
    }

    updateVoiceState(data) {
        if (!data || !data.d) return;
        const guildId = data.d.guild_id;
        if (!guildId) return;

        let state = this.voiceStates.get(guildId) || {};

        if (data.t === "VOICE_SERVER_UPDATE") {
            state.serverUpdate = data.d;
        } else if (data.t === "VOICE_STATE_UPDATE") {
            if (!this.clientId || String(data.d.user_id) === String(this.clientId)) {
                state.stateUpdate = data.d;
            }
        }

        this.voiceStates.set(guildId, state);

        if (state.serverUpdate && state.stateUpdate && this.sessionId) {
            this.sendVoiceUpdate(guildId, state);
        }
    }

    async sendVoiceUpdate(guildId, state) {
        try {
            await axios.patch(
                `${this.httpUrl}/v4/sessions/${this.sessionId}/players/${guildId}`,
                {
                    voice: {
                        token: state.serverUpdate.token,
                        endpoint: state.serverUpdate.endpoint,
                        sessionId: state.stateUpdate.session_id
                    }
                },
                {
                    headers: {
                        Authorization: this.password,
                        "Content-Type": "application/json"
                    },
                    timeout: 8000
                }
            );
            console.log(`[LAVALINK] 🔊 Voice state synchronized for guild: ${guildId}`);
        } catch (e) {
            // If v4 patch fails, try v3 send if socket is open
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                try {
                    this.socket.send(JSON.stringify({
                        op: "voiceUpdate",
                        guildId: guildId,
                        sessionId: state.stateUpdate?.session_id,
                        event: state.serverUpdate
                    }));
                } catch (wsErr) {}
            }
        }
    }

    createPlayer(guildId, voiceChannelId, textChannelId, discordClient) {
        let player = this.players.get(guildId);
        if (!player) {
            player = new LavalinkPlayer(this, guildId, voiceChannelId, textChannelId, discordClient);
            this.players.set(guildId, player);
        } else {
            player.voiceChannelId = voiceChannelId;
            player.textChannelId = textChannelId;
            player.discordClient = discordClient;
        }
        return player;
    }

    getPlayer(guildId) {
        return this.players.get(guildId);
    }

    destroyPlayer(guildId) {
        const player = this.players.get(guildId);
        if (player) {
            player.destroy();
            this.players.delete(guildId);
        }
    }

    async search(query) {
        if (!query) return { loadType: "NO_MATCHES", tracks: [] };
        const cleanQuery = query.trim().replace(/^[<"']|[>"']$/g, "").trim();

        let normalizedUrl = null;
        let ytTitle = null;
        const ytIdMatch = cleanQuery.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/|live\/))([a-zA-Z0-9_-]{11})/i);
        if (ytIdMatch && ytIdMatch[1]) {
            normalizedUrl = `https://www.youtube.com/watch?v=${ytIdMatch[1]}`;
            try {
                const oembed = await axios.get(`https://www.youtube.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`, { timeout: 3500 });
                if (oembed.data?.title) ytTitle = oembed.data.title;
            } catch (e) {
                try {
                    const noembed = await axios.get(`https://noembed.com/embed?url=${encodeURIComponent(normalizedUrl)}`, { timeout: 3500 });
                    if (noembed.data?.title) ytTitle = noembed.data.title;
                } catch (e2) {}
            }
        }

        const isUrl = cleanQuery.startsWith("http://") || cleanQuery.startsWith("https://") || Boolean(normalizedUrl);
        const identifiers = [];
        if (normalizedUrl) {
            identifiers.push(normalizedUrl);
            if (ytTitle) {
                identifiers.push(`scsearch:${ytTitle}`, `ytmsearch:${ytTitle}`, `ytsearch:${ytTitle}`, `spsearch:${ytTitle}`);
            }
            identifiers.push(cleanQuery);
        } else if (isUrl) {
            identifiers.push(cleanQuery, `scsearch:${cleanQuery}`, `ytsearch:${cleanQuery}`);
        } else {
            identifiers.push(
                `scsearch:${cleanQuery}`,
                `ytsearch:${cleanQuery}`,
                `ytmsearch:${cleanQuery}`,
                `spsearch:${cleanQuery}`
            );
        }

        // Try searching across current node first; if no results, try other nodes in the pool
        const nodesToTry = [
            this.currentNode,
            ...this.nodes.filter((_, idx) => idx !== (this.currentNodeIndex % this.nodes.length))
        ];

        for (const targetNode of nodesToTry) {
            const proto = targetNode.secure ? "https" : "http";
            const baseUrl = `${proto}://${targetNode.host}:${targetNode.port}`;

            for (const identifier of identifiers) {
                try {
                    const url = `${baseUrl}/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`;
                    const res = await axios.get(url, {
                        headers: { Authorization: targetNode.password },
                        timeout: 9000
                    });

                    const data = res.data;
                    if (!data) continue;

                    // Lavalink v4 response format
                    if (data.loadType === "search" || data.loadType === "SEARCH_RESULT") {
                        const rawTracks = Array.isArray(data.data) ? data.data : (data.tracks || []);
                        if (rawTracks.length > 0) {
                            const tracks = rawTracks.map(t => ({
                                encoded: t.encoded || t.track,
                                title: t.info?.title || "Unknown Title",
                                author: t.info?.author || "Unknown Artist",
                                duration: t.info?.length || 0,
                                uri: t.info?.uri || identifier
                            }));

                            // If not currently connected and another node succeeded, fail over session to it
                            if (!this.connected && targetNode.host !== this.currentNode.host) {
                                const targetIdx = this.nodes.findIndex(n => n.host === targetNode.host);
                                if (targetIdx !== -1) {
                                    this.currentNodeIndex = targetIdx;
                                    this.connect();
                                }
                            }

                            return { loadType: "SEARCH_RESULT", tracks };
                        }
                    } else if (data.loadType === "track" || data.loadType === "TRACK_LOADED") {
                        const t = data.data || data.tracks?.[0];
                        if (t) {
                            const track = {
                                encoded: t.encoded || t.track,
                                title: t.info?.title || "Unknown Title",
                                author: t.info?.author || "Unknown Artist",
                                duration: t.info?.length || 0,
                                uri: t.info?.uri || identifier
                            };

                            if (!this.connected && targetNode.host !== this.currentNode.host) {
                                const targetIdx = this.nodes.findIndex(n => n.host === targetNode.host);
                                if (targetIdx !== -1) {
                                    this.currentNodeIndex = targetIdx;
                                    this.connect();
                                }
                            }

                            return { loadType: "TRACK_LOADED", tracks: [track] };
                        }
                    } else if (data.loadType === "playlist" || data.loadType === "PLAYLIST_LOADED") {
                        const rawTracks = data.data?.tracks || data.tracks || [];
                        if (rawTracks.length > 0) {
                            const playlistName = data.data?.info?.name || data.playlistInfo?.name || "Playlist";
                            const tracks = rawTracks.map(t => ({
                                encoded: t.encoded || t.track,
                                title: t.info?.title || "Unknown Title",
                                author: t.info?.author || "Unknown Artist",
                                duration: t.info?.length || 0,
                                uri: t.info?.uri || identifier
                            }));

                            if (!this.connected && targetNode.host !== this.currentNode.host) {
                                const targetIdx = this.nodes.findIndex(n => n.host === targetNode.host);
                                if (targetIdx !== -1) {
                                    this.currentNodeIndex = targetIdx;
                                    this.connect();
                                }
                            }

                            return { loadType: "PLAYLIST_LOADED", playlist: { name: playlistName }, tracks };
                        }
                    }
                } catch (e) {
                    console.warn(`[LAVALINK SEARCH NOTE] ${targetNode.host} -> ${identifier}: ${e.message}`);
                }
            }
        }

        return { loadType: "NO_MATCHES", tracks: [] };
    }
}

class LavalinkPlayer {
    constructor(lavalink, guildId, voiceChannelId, textChannelId, discordClient) {
        this.lavalink = lavalink;
        this.guildId = guildId;
        this.voiceChannelId = voiceChannelId;
        this.textChannelId = textChannelId;
        this.discordClient = discordClient;
        this.queue = [];
        this.current = null;
        this.playing = false;
        this.paused = false;
        this.volume = 100;
        this.announcedTrack = null;
    }

    async connect() {
        const guild = this.discordClient?.guilds?.cache?.get(this.guildId);
        if (guild && this.voiceChannelId) {
            try {
                if (guild.shard && typeof guild.shard.send === "function") {
                    guild.shard.send({
                        op: 4,
                        d: {
                            guild_id: this.guildId,
                            channel_id: this.voiceChannelId,
                            self_mute: false,
                            self_deaf: true
                        }
                    });
                }
            } catch (e) {
                console.warn("[LAVALINK] guild.shard.send error:", e.message);
            }
            // Wait briefly for voice gateway credentials to sync with Lavalink
            for (let i = 0; i < 20; i++) {
                const vs = this.lavalink.voiceStates.get(this.guildId);
                if (vs?.serverUpdate && vs?.stateUpdate) break;
                await new Promise(r => setTimeout(r, 100));
            }
        }
    }

    async play(track) {
        const nextTrack = track || this.queue.shift();
        if (!nextTrack) {
            this.playing = false;
            this.current = null;
            return;
        }

        this.current = nextTrack;
        this.playing = true;
        this.paused = false;

        let vs = this.lavalink.voiceStates.get(this.guildId);
        if (!vs?.serverUpdate || !vs?.stateUpdate) {
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 100));
                vs = this.lavalink.voiceStates.get(this.guildId);
                if (vs?.serverUpdate && vs?.stateUpdate) break;
            }
        }

        if (vs?.serverUpdate && vs?.stateUpdate && this.lavalink.sessionId) {
            await this.lavalink.sendVoiceUpdate(this.guildId, vs).catch(() => { });
        }

        if (this.lavalink.sessionId) {
            try {
                const patchData = {
                    track: { encoded: nextTrack.encoded },
                    volume: this.volume
                };
                if (vs?.serverUpdate && vs?.stateUpdate) {
                    patchData.voice = {
                        token: vs.serverUpdate.token,
                        endpoint: vs.serverUpdate.endpoint,
                        sessionId: vs.stateUpdate.session_id
                    };
                } else {
                    console.warn(`[LAVALINK] ⚠️ Discord voice connection not confirmed for guild ${this.guildId}. Verify bot has 'Connect' permission.`);
                }

                await axios.patch(
                    `${this.lavalink.httpUrl}/v4/sessions/${this.lavalink.sessionId}/players/${this.guildId}`,
                    patchData,
                    {
                        headers: {
                            Authorization: this.lavalink.password,
                            "Content-Type": "application/json"
                        },
                        timeout: 8000
                    }
                );
                console.log(`[LAVALINK PLAY] ▶️ Streaming: ${nextTrack.title}`);
            } catch (e) {
                const errDetail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
                console.error("[LAVALINK PLAY ERROR]", errDetail);
                if (e.response?.status === 429 || e.response?.status === 403 || e.response?.status === 502) {
                    this.lavalink.switchToNextNode(`Node returned HTTP ${e.response?.status || e.message}`);
                }
                throw e;
            }
        }
    }

    async pause(shouldPause = true) {
        this.paused = shouldPause;
        if (this.lavalink.sessionId) {
            try {
                await axios.patch(
                    `${this.lavalink.httpUrl}/v4/sessions/${this.lavalink.sessionId}/players/${this.guildId}`,
                    { paused: shouldPause },
                    {
                        headers: {
                            Authorization: this.lavalink.password,
                            "Content-Type": "application/json"
                        },
                        timeout: 5000
                    }
                );
            } catch (e) { }
        }
    }

    async setVolume(vol) {
        this.volume = Math.max(0, Math.min(1000, vol));
        if (this.lavalink.sessionId) {
            try {
                await axios.patch(
                    `${this.lavalink.httpUrl}/v4/sessions/${this.lavalink.sessionId}/players/${this.guildId}`,
                    { volume: this.volume },
                    {
                        headers: {
                            Authorization: this.lavalink.password,
                            "Content-Type": "application/json"
                        },
                        timeout: 5000
                    }
                );
            } catch (e) { }
        }
    }

    async stop() {
        this.queue.length = 0;
        this.playing = false;
        this.current = null;
        if (this.lavalink.sessionId) {
            try {
                await axios.patch(
                    `${this.lavalink.httpUrl}/v4/sessions/${this.lavalink.sessionId}/players/${this.guildId}`,
                    { track: { encoded: null } },
                    {
                        headers: {
                            Authorization: this.lavalink.password,
                            "Content-Type": "application/json"
                        },
                        timeout: 5000
                    }
                );
            } catch (e) { }
        }
    }

    async destroy() {
        this.stop();
        if (this.lavalink.sessionId) {
            try {
                await axios.delete(
                    `${this.lavalink.httpUrl}/v4/sessions/${this.lavalink.sessionId}/players/${this.guildId}`,
                    {
                        headers: { Authorization: this.lavalink.password },
                        timeout: 5000
                    }
                );
            } catch (e) { }
        }
        const guild = this.discordClient.guilds.cache.get(this.guildId);
        if (guild) {
            guild.shard.send({
                op: 4,
                d: {
                    guild_id: this.guildId,
                    channel_id: null,
                    self_mute: false,
                    self_deaf: false
                }
            });
        }
        this.lavalink.players.delete(this.guildId);
    }

    onTrackEnd(payload) {
        if (payload?.reason === "replaced") return;
        if (this.queue.length > 0) {
            this.play().catch(e => console.error("[LAVALINK QUEUE PLAY ERROR]", e.message));
        } else {
            this.playing = false;
            this.current = null;
        }
    }

    onTrackStart(payload) {
        this.playing = true;
        if (this.textChannelId && this.current && this.discordClient) {
            try {
                const channel = this.discordClient.channels?.cache?.get(this.textChannelId);
                if (channel && typeof channel.send === "function" && this.announcedTrack !== this.current.encoded) {
                    this.announcedTrack = this.current.encoded;
                    channel.send(`▶️ **Now Playing (Lavalink):** **${this.current.title}** (\`${this.current.author || 'Artist'}\`)`).catch(() => {});
                }
            } catch (e) {}
        }
    }
}

module.exports = { LavalinkClient, LavalinkPlayer, DEFAULT_NODES };

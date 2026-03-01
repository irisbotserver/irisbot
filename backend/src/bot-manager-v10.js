const Baileys = require("@whiskeysockets/baileys");
const {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    downloadContentFromMessage,
    makeCacheableSignalKeyStore,
    delay,
    jidDecode,
    getContentType
} = Baileys;

const makeWASocket = Baileys.default || Baileys;
const P = require("pino");
const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const { Boom } = require("@hapi/boom");

/**
 * PRODUCTION INSTANCE RUNTIME - ARCHITECTURE V12 (STABLE RESTORE)
 * Preserva 100% da lógica original com correções de sintaxe no menu dinâmico.
 */
async function startInstance(instanceConfig) {
    const {
        uuid,
        botName = "IRIS",
        adminNumber: rawAdminNumber,
        botNumber: rawBotNumber,
        usePairingCode = true,
        prefix: configPrefix
    } = instanceConfig;

    const instanceBaseDir = path.resolve(__dirname, "..", "instances", uuid);
    const sessionDir = path.join(instanceBaseDir, "session");
    const databaseDir = path.join(instanceBaseDir, "database");

    if (!fs.existsSync(databaseDir)) await fsPromises.mkdir(databaseDir, { recursive: true });
    if (!fs.existsSync(sessionDir)) await fsPromises.mkdir(sessionDir, { recursive: true });

    const PREFIX = configPrefix || ".";
    const adminNumber = rawAdminNumber.includes("@") ? rawAdminNumber : `${rawAdminNumber.replace(/\D/g, "")}@s.whatsapp.net`;
    const botNumber = rawBotNumber.replace(/\D/g, "");

    const msgCache = new Map();
    const CACHE_LIMIT = 500;

    const addToCache = (id, msg) => {
        msgCache.set(id, msg);
        if (msgCache.size > CACHE_LIMIT) {
            const firstKey = msgCache.keys().next().value;
            msgCache.delete(firstKey);
        }
    };

    const getDirSize = async (dirPath) => {
        try {
            const files = await fsPromises.readdir(dirPath, { withFileTypes: true });
            const stats = await Promise.all(files.map(async (file) => {
                const filePath = path.join(dirPath, file.name);
                if (file.isDirectory()) return getDirSize(filePath);
                const { size } = await fsPromises.stat(filePath);
                return size;
            }));
            return stats.reduce((acc, size) => acc + size, 0);
        } catch (e) { return 0; }
    };

    const cleanupPreKeys = async () => {
        try {
            const files = await fsPromises.readdir(sessionDir);
            const preKeys = files
                .filter(f => f.startsWith('pre-key-') && f.endsWith('.json'))
                .map(f => ({ name: f, num: parseInt(f.split('-')[2]) }))
                .sort((a, b) => b.num - a.num);

            if (preKeys.length > 50) {
                const toDelete = preKeys.slice(50);
                await Promise.all(toDelete.map(f => fsPromises.unlink(path.join(sessionDir, f.name))));
                return toDelete.length;
            }
        } catch (e) { }
        return 0;
    };

    const dbFile = path.join(databaseDir, "baileys_db.json");
    const backupCacheFile = path.join(databaseDir, "baileys_store.json");

    let db = { users: {}, groups: {}, stats: { commands: 0, messages: 0 }, logs: [] };

    const loadDatabase = () => {
        if (fs.existsSync(dbFile)) {
            try { db = JSON.parse(fs.readFileSync(dbFile)); } catch (e) { }
        }
    };

    const saveDatabase = () => {
        try {
            fs.writeFileSync(dbFile, JSON.stringify(db));
            const cacheObj = Object.fromEntries(Array.from(msgCache.entries()).slice(-100));
            fs.writeFileSync(backupCacheFile, JSON.stringify(cacheObj));
        } catch (e) { }
    };

    const addLog = (text) => {
        const time = new Date().toLocaleTimeString();
        db.logs.push(`[${time}] ${text}`);
        if (db.logs.length > 50) db.logs.shift();
    };

    loadDatabase();
    const dbInterval = setInterval(saveDatabase, 30000);
    const cleanInterval = setInterval(cleanupPreKeys, 6 * 60 * 60 * 1000);

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: P({ level: "silent" }),
        printQRInTerminal: !usePairingCode,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, P({ level: "silent" })),
        },
        browser: ["Ubuntu", "Chrome", "110.0.5481.178"],
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        syncFullHistory: false
    });

    sock.copyNForward = async (jid, message, forceForward = false, options = {}) => {
        let vtype;
        if (options.readViewOnce) {
            message.message = message.message && message.message.viewOnceMessageV2 && message.message.viewOnceMessageV2.message ? message.message.viewOnceMessageV2.message : (message.message && message.message.viewOnceMessage && message.message.viewOnceMessage.message ? message.message.viewOnceMessage.message : message.message);
            vtype = Object.keys(message.message)[0];
            delete message.message.viewOnceMessageV2;
            delete message.message[vtype].viewOnce;
            message.message = { ...message.message };
        }
        let type = Object.keys(message.message)[0];
        let content = message.message[type];
        if (type == 'viewOnceMessageV2') { content = message.message.viewOnceMessageV2.message; type = Object.keys(content)[0]; }
        let contextInfo = {};
        if (type == 'extendedTextMessage') contextInfo = content.contextInfo;
        message.message[type].contextInfo = { ...contextInfo, ...options.contextInfo };
        const waMessage = await Baileys.generateWAMessageFromContent(jid, message.message, { userJid: sock.user.id, ...options });
        await sock.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id });
        return waMessage;
    };

    sock.ev.on("creds.update", saveCreds);

    if (usePairingCode && !state.creds.registered) {
        const cleanNumber = botNumber.replace(/\D/g, '');
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(cleanNumber);
                console.log(`\n\x1b[1;33m[PAIRING] [${uuid}] CODE: ${code}\x1b[0m\n`);
                sock.ev.emit("connection.update", { pairingCode: code });
            } catch (e) { }
        }, 6000);
    }

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "open") {
            console.log(`✅ [${botName}] On-line para UUID: ${uuid}`);
            await sock.sendMessage(adminNumber, { text: `😈 *${botName} ONLINE*` }).catch(() => { });
        }
        if (connection === "close") {
            clearInterval(dbInterval);
            clearInterval(cleanInterval);
            const statusCode = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output?.statusCode : 500;
            if (statusCode !== DisconnectReason.loggedOut && statusCode !== 401) {
                setTimeout(() => startInstance(instanceConfig), 10000);
            }
        }
    });

    sock.ev.on("group-participants.update", async (update) => {
        const { id, participants, action } = update;
        if (action === "add" && db.groups[id]?.welcome) {
            const groupMetadata = await sock.groupMetadata(id).catch(() => null);
            const groupName = groupMetadata?.subject || "Grupo";
            for (const p of participants) {
                const text = `👋 *BEM-VINDO(A)* @${p.split('@')[0]} ao grupo *${groupName}*!\n\nUse ${PREFIX}menu para ver meus comandos.`;
                await sock.sendMessage(id, { text, mentions: [p] });
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        for (const msg of messages) {
            try {
                if (!msg.message) continue;
                const from = msg.key.remoteJid;
                const isGroup = from.endsWith('@g.us');
                const messageType = Object.keys(msg.message)[0];
                const msgId = msg.key.id;
                const sender = msg.key.participant || msg.key.remoteJid;
                const isOwner = sender.includes(adminNumber.split('@')[0]) || msg.key.fromMe;

                db.stats.messages++;

                if (messageType !== 'protocolMessage') addToCache(msgId, msg);

                if (messageType === 'protocolMessage' && msg.message.protocolMessage?.key) {
                    await handleAntiDelete(sock, msg, msgCache, adminNumber);
                    continue;
                }

                const viewOnce = msg.message?.viewOnceMessageV2?.message || msg.message?.viewOnceMessage?.message;
                if (viewOnce) await handleAutoReveal(sock, msg, viewOnce, adminNumber);

                const body = ((messageType === "conversation" ? msg.message.conversation : messageType === "extendedTextMessage" ? msg.message.extendedTextMessage?.text : messageType === "imageMessage" ? msg.message.imageMessage?.caption : messageType === "videoMessage" ? msg.message.videoMessage?.caption : "") || "").trim();
                if (!body) continue;

                if (!db.users[sender]) db.users[sender] = { xp: 0, level: 1, warns: 0, blacklist: false, whitelist: false };
                if (db.users[sender].blacklist && !isOwner && !db.users[sender].whitelist) return;

                db.users[sender].xp += Math.floor(Math.random() * 10) + 5;
                const nextLevel = db.users[sender].level * 500;
                if (db.users[sender].xp >= nextLevel) {
                    db.users[sender].level++;
                    if (!msg.key.fromMe) await sock.sendMessage(from, { text: `🎉 *PARABÉNS* @${sender.split('@')[0]}! Nível *${db.users[sender].level}*!`, mentions: [sender] });
                }

                if (isGroup && db.groups[from]?.replies?.[body.toLowerCase()]) {
                    await sock.sendMessage(from, { text: db.groups[from].replies[body.toLowerCase()] });
                }

                const args = body.split(/ +/);
                const command = args[0].toLowerCase();
                const textAfter = body.slice(command.length).trim();
                const isCmd = body.startsWith(PREFIX);
                const q = isCmd ? command.slice(PREFIX.length) : command;

                const groupMetadata = isGroup ? await sock.groupMetadata(from).catch(() => null) : null;
                const participants = groupMetadata ? groupMetadata.participants : [];
                const admins = participants.filter(p => p.admin).map(p => p.id);
                const isAdmins = admins.includes(sender);
                const isBotAdmins = admins.map(a => a.split('@')[0].replace(/\D/g, '')).includes(botNumber.replace(/\D/g, ''));

                if (q === "menu" || q === "system") {
                    if (q === "menu") {
                        const isPrivate = body.toLowerCase().includes("private");
                        const isAll = body.toLowerCase().includes("all");

                        if (isPrivate) {
                            if (!isOwner) return;
                            const privateMenu = "🔐 *" + botName + " PAINEL DE CONTROLE*\n\n" +
                                "🤖 *Status:* Online\n" +
                                "📦 *Cache Mídia:* " + msgCache.size + "/500\n" +
                                "📊 *Msgs Processadas:* " + db.stats.messages + "\n\n" +
                                "🛠️ *CONTROLES TÉCNICOS*\n" +
                                "├ .cleancache - Limpa buffer de mídia\n" +
                                "├ .vercache - Vê tamanho atual do cache\n" +
                                "├ .broadcast [msg] - Aviso para todos grupos\n" +
                                "├ .blacklist add [num] - Bloqueia número\n" +
                                "├ .whitelist add [num] - Libera número\n" +
                                "├ .groups - Lista grupos ativos\n" +
                                "├ .log - Vê logs do sistema\n" +
                                "└ .memory - Uso de RAM do bot\n\n" +
                                "━━━━━━━━━━━━━━━━━━━";
                            return await sock.sendMessage(from, { text: privateMenu });
                        }

                        if (isAll) {
                            const allMenu = "📚 *IRIS COMPENDIUM - GUIA COMPLETO*\n\n" +
                                "📸 *REVELAR MÍDIA*\n" +
                                "├ *.ver / .explanar* - Revela visualização única\n" +
                                "├ *kkk / perai* - Atalhos para revelar\n\n" +
                                "🔨 *MODERAÇÃO*\n" +
                                "├ *.ban / .promote / .demote*\n" +
                                "├ *.warn / .mute / .unmute*\n" +
                                "├ *.clear [n]* - Limpa histórico\n" +
                                "└ *.tagall / .hideall* - Marcar todos\n\n" +
                                "⚙️ *CONFIGURAÇÃO ATIVA*\n" +
                                "├ *.system config* - Status das travas\n" +
                                "├ *.antilink / .antiflood*\n" +
                                "├ *.antimedia / .welcome*\n" +
                                "└ *.captcha / .span*\n\n" +
                                "🎭 *INTERAÇÃO & XP*\n" +
                                "├ *.addreply / .delreply / .listreply*\n" +
                                "└ *.rank / .level / .xp / .mode*\n\n" +
                                "🎰 *UTILITÁRIOS*\n" +
                                "├ *.sorteio / .enquete / .stats*\n" +
                                "└ *.vercache / .cleancache* (Novo)\n\n" +
                                "━━━━━━━━━━━━━━━━━━━";
                            return await sock.sendMessage(from, { text: allMenu });
                        }

                        const menu = "🚀 *" + botName + " AUTORIDADE* 🚀\n\n" +
                            "📸 *REVELAR MÍDIA*\n" +
                            "├ .ver / .explanar / kkk / perai\n\n" +
                            "🔨 *MODERAÇÃO*\n" +
                            "├ .ban / .promote / .demote\n" +
                            "├ .warn / .mute / .unmute\n" +
                            "└ .clear [n] / .tagall / .hideall\n\n" +
                            "⚙️ *SISTEMA & CONFIG*\n" +
                            "├ .system config / .antilink\n" +
                            "├ .antiflood / .antimedia\n" +
                            "├ .welcome / .captcha / .span\n\n" +
                            "🎭 *INTERAÇÃO & PERFORMANCE*\n" +
                            "├ .addreply / .listreply / .rank\n" +
                            "├ .level / .xp / .mode / .stats\n" +
                            "├ .vercache / .cleancache\n" +
                            "└ .menu private / .menu all\n\n" +
                            "━━━━━━━━━━━━━━━━━━━";
                        return await sock.sendMessage(from, { text: menu });
                    }

                    if (q === "system" && args[1] === "config") {
                        if (!isGroup || (!isAdmins && !isOwner)) return;
                        if (!db.groups[from]) db.groups[from] = { antilink: false, replies: {} };
                        const g = db.groups[from];
                        const cfgTxt = "⚙️ *PAINEL: " + botName + "*\n\n" +
                            "🔗 *Antilink:* " + (g.antilink ? "✅" : "❌") + "\n" +
                            "📸 *Antimedia:* " + (g.antimedia ? "✅" : "❌") + "\n" +
                            "🤝 *Welcome:* " + (g.welcome ? "✅" : "❌") + "\n" +
                            "🎭 *Modo:* " + (g.mode || "serio") + "\n\n" +
                            "📊 *Membros:* " + participants.length + "\n" +
                            "🛡️ *Admin Bot:* " + (isBotAdmins ? "✅ Sim" : "❌ Não");
                        return await sock.sendMessage(from, { text: cfgTxt });
                    }
                }

                if (["ver", "explanar", "kkk", "perai"].includes(q)) {
                    await handleRevealMedia(sock, msg, adminNumber);
                    continue;
                }

                if (!isCmd) continue;
                db.stats.commands++;
                addLog(`Cmd: ${command} de ${sender}`);

                if (q === "vercache") {
                    if (!isOwner) return;
                    const files = await fsPromises.readdir(sessionDir);
                    const preKeyCount = files.filter(f => f.startsWith('pre-key-')).length;
                    const diskSize = (await getDirSize(instanceBaseDir)) / 1024 / 1024;
                    const ramUsage = process.memoryUsage().heapUsed / 1024 / 1024;
                    const stats = "📊 *ESTATÍSTICAS DE CACHE*\n\n" +
                        "🔑 *Pre-Keys:* " + preKeyCount + "\n" +
                        "🧠 *Memória:* " + msgCache.size + "/" + CACHE_LIMIT + " msgs\n" +
                        "💽 *Uso em Disco:* " + diskSize.toFixed(2) + " MB\n" +
                        "🔋 *RAM:* " + ramUsage.toFixed(2) + " MB";
                    return await sock.sendMessage(from, { text: stats });
                }

                if (q === "cleancache") {
                    if (!isOwner) return;
                    const deletedCount = await cleanupPreKeys();
                    msgCache.clear();
                    return await sock.sendMessage(from, { text: "🧹 Otimizado! " + deletedCount + " pre-keys removidas." });
                }

                if (q === "ban" && isGroup && isBotAdmins && (isAdmins || isOwner)) {
                    const target = msg.message.extendedTextMessage?.contextInfo?.participant || msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (target) await sock.groupParticipantsUpdate(from, [target], "remove");
                }
                if (q === "promote" && isGroup && isBotAdmins && (isAdmins || isOwner)) {
                    const target = msg.message.extendedTextMessage?.contextInfo?.participant || msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (target) await sock.groupParticipantsUpdate(from, [target], "promote");
                }
                if (q === "demote" && isGroup && isBotAdmins && (isAdmins || isOwner)) {
                    const target = msg.message.extendedTextMessage?.contextInfo?.participant || msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (target) await sock.groupParticipantsUpdate(from, [target], "demote");
                }
                if (q === "warn" && isGroup && (isAdmins || isOwner)) {
                    const target = msg.message.extendedTextMessage?.contextInfo?.participant || msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (target) {
                        if (!db.users[target]) db.users[target] = { xp: 0, level: 1, warns: 0 };
                        db.users[target].warns++;
                        await sock.sendMessage(from, { text: "⚠️ Advertência @" + target.split('@')[0] + " (" + db.users[target].warns + "/3)", mentions: [target] });
                        if (db.users[target].warns >= 3 && isBotAdmins) await sock.groupParticipantsUpdate(from, [target], "remove");
                    }
                }
                if (q === "mute" && isBotAdmins && (isAdmins || isOwner)) await sock.groupSettingUpdate(from, 'announcement');
                if (q === "unmute" && isBotAdmins && (isAdmins || isOwner)) await sock.groupSettingUpdate(from, 'not_announcement');
                if (q === "clear" && isGroup && (isAdmins || isOwner)) {
                    const num = parseInt(args[1]) || 10;
                    const msgs = Array.from(msgCache.values()).filter(m => m.key.remoteJid === from).slice(-(num + 1));
                    for (const m of msgs) { try { await sock.sendMessage(from, { delete: m.key }); await delay(500); } catch (e) { } }
                }
                if (q === "tagall" || q === "hideall") {
                    if (!isGroup || (!isAdmins && !isOwner)) return;
                    const jids = participants.map(p => p.id);
                    await sock.sendMessage(from, { text: "📢 *CHAMADA GERAL*\n\n" + (q === "tagall" ? jids.map(j => "@" + j.split('@')[0]).join(" ") : ""), mentions: jids });
                }
                if (["antilink", "antiflood", "antimedia", "captcha", "welcome", "span"].includes(q)) {
                    if (!isGroup || (!isAdmins && !isOwner)) return;
                    if (!db.groups[from]) db.groups[from] = { antilink: false, replies: {} };
                    db.groups[from][q] = (args[1] === "on");
                    await sock.sendMessage(from, { text: "🛡️ *" + q.toUpperCase() + "*: " + (db.groups[from][q] ? "ON" : "OFF") });
                }
                if (q === "addreply" && isGroup && (isAdmins || isOwner)) {
                    const parts = textAfter.split("|");
                    if (parts.length < 2) return await sock.sendMessage(from, { text: "❌ Gatilho | Resposta" });
                    if (!db.groups[from]) db.groups[from] = { replies: {} };
                    db.groups[from].replies[parts[0].trim().toLowerCase()] = parts[1].trim();
                    await sock.sendMessage(from, { text: "✅ Ok" });
                }
                if (q === "listreply" && isGroup) {
                    const replies = Object.keys(db.groups[from]?.replies || {});
                    await sock.sendMessage(from, { text: "📋 Respostas:\n" + replies.join("\n") });
                }
                if (q === "rank") {
                    const sorted = Object.entries(db.users).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
                    let txt = "🏆 *RANK*\n";
                    sorted.forEach((u, i) => txt += (i + 1) + "º @" + u[0].split('@')[0] + "\n");
                    await sock.sendMessage(from, { text: txt, mentions: sorted.map(u => u[0]) });
                }
                if (q === "level") await sock.sendMessage(from, { text: "📊 Lvl: " + db.users[sender].level });
                if (q === "sorteio" && isGroup) {
                    const win = participants[Math.floor(Math.random() * participants.length)].id;
                    await sock.sendMessage(from, { text: "🎉 @" + win.split('@')[0], mentions: [win] });
                }
                if (q === "broadcast" && isOwner) {
                    const groups = Object.keys(await sock.groupFetchAllParticipating());
                    for (let g of groups) { await sock.sendMessage(g, { text: "📢 " + textAfter }); await delay(1000); }
                }
                if (q === "memory" && isOwner) await sock.sendMessage(from, { text: "📦 RAM: " + Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + " MB" });

            } catch (err) { }
        }
    });

    return sock;
}

async function handleAntiDelete(sock, msg, msgCache, adminNumber) {
    const protocolMessage = msg.message.protocolMessage;
    const targetId = protocolMessage.key.id;
    try {
        await delay(1000);
        const deletedMsg = msgCache.get(targetId);
        if (deletedMsg && adminNumber) {
            const realSender = deletedMsg.key.participant || deletedMsg.key.remoteJid;
            const originalType = Object.keys(deletedMsg.message)[0];
            let content = originalType === 'conversation' ? deletedMsg.message.conversation : (originalType === 'extendedTextMessage' ? deletedMsg.message.extendedTextMessage.text : "[" + originalType + "]");
            const response = "*🕵️ ANTIDELETE*\n👤 @" + realSender.split('@')[0] + "\n💬 " + content;
            await sock.sendMessage(adminNumber, { text: response, mentions: [realSender] });
            if (!['conversation', 'extendedTextMessage'].includes(originalType)) await sock.copyNForward(adminNumber, deletedMsg, false);
        }
    } catch (e) { }
}

async function handleRevealMedia(sock, msg, adminNumber) {
    const q = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
    const self = msg.message?.viewOnceMessageV2?.message || msg.message?.viewOnceMessage?.message;
    const target = q || self;
    if (!target) return;
    try {
        let v = target.viewOnceMessageV2?.message || target.viewOnceMessage?.message || target;
        let type = Object.keys(v)[0];
        if (type === 'messageContextInfo') type = Object.keys(v)[1];
        let streamType = type.replace('Message', '');
        const stream = await downloadContentFromMessage(v[type], streamType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        if (streamType === 'image') await sock.sendMessage(adminNumber, { image: buffer, caption: "💀 Revelado." });
        else if (streamType === 'video') await sock.sendMessage(adminNumber, { video: buffer, caption: "💀 Revelado." });
    } catch (e) { }
}

async function handleAutoReveal(sock, msg, vMsg, adminNumber) {
    try {
        if (!adminNumber) return;
        const sender = msg.key.participant || msg.key.remoteJid;
        const type = Object.keys(vMsg)[0];
        const streamType = type.replace('Message', '');
        const stream = await downloadContentFromMessage(vMsg[type], streamType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        const cap = "👁️ *VIEW-ONCE* de @" + sender.split('@')[0];
        if (streamType === 'image') await sock.sendMessage(adminNumber, { image: buffer, caption: cap, mentions: [sender] });
        else if (streamType === 'video') await sock.sendMessage(adminNumber, { video: buffer, caption: cap, mentions: [sender] });
    } catch (e) { }
}

module.exports = { startInstance };

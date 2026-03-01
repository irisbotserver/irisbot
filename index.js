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
const { Boom } = require("@hapi/boom");
const os = require("os");

// =======================================================
// ⚙️ CONFIGURAÇÕES TOPO (IRIS IDENTITY)
// =======================================================
const BOT_NAME = "IRIS";
const adminNumber = "5511963239892@s.whatsapp.net";
const botNumber = "5511963239892";
const usePairingCode = true;
const PREFIX = ".";

// CACHE E PERSISTÊNCIA
const cacheFile = "./baileys_store.json";
const dbFile = "./baileys_db.json";
const msgCache = new Map();

// =======================================================
// 🗄️ SISTEMA DE BANCO DE DADOS (IN-MEMORY + JSON)
// =======================================================
let db = {
    users: {},     // { jid: { xp, level, warns, blacklist, whitelist } }
    groups: {},    // { jid: { antilink, antiflood, antimedia, allowlinks, captcha, welcome, span, mode, replies: {} } }
    stats: { commands: 0, messages: 0 },
    logs: []       // Últimos 50 logs
};

function loadDatabase() {
    if (fs.existsSync(dbFile)) {
        try { db = JSON.parse(fs.readFileSync(dbFile)); } catch (e) { }
    }
    if (fs.existsSync(cacheFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(cacheFile));
            Object.entries(data).forEach(([key, val]) => msgCache.set(key, val));
        } catch (e) { }
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(dbFile, JSON.stringify(db));
        fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(msgCache)));

        const blacklist = Object.keys(db.users).filter(u => db.users[u].blacklist);
        const whitelist = Object.keys(db.users).filter(u => db.users[u].whitelist);
        fs.writeFileSync("./blacklist.json", JSON.stringify(blacklist, null, 2));
        fs.writeFileSync("./whitelist.json", JSON.stringify(whitelist, null, 2));
    } catch (e) { }
}

loadDatabase();
setInterval(saveDatabase, 10000);

const addLog = (text) => {
    const time = new Date().toLocaleTimeString();
    db.logs.push(`[${time}] ${text}`);
    if (db.logs.length > 50) db.logs.shift();
};

// =======================================================
// 🛠️ FUNÇÕES DE SUPORTE E ERRO (ADMIN EXCLUSIVE)
// =======================================================
async function sendToAdmin(sock, message) {
    if (typeof message === 'string') {
        await sock.sendMessage(adminNumber, { text: message }).catch(() => { });
    } else {
        await sock.sendMessage(adminNumber, message).catch(() => { });
    }
}

async function handleError(sock, error, context) {
    const { command, sender, from, isGroup } = context;
    const errorMessage = `❌ *ERRO DETECTADO NO SISTEMA*\n\n` +
        `👤 *Sender:* @${sender.split('@')[0]}\n` +
        `📍 *Local:* ${isGroup ? `Grupo (${from})` : "Privado"}\n` +
        `⌨️ *Comando:* ${PREFIX}${command || "N/A"}\n\n` +
        `📖 *Erro:* ${error.message}\n\n` +
        `📜 *Stack Trace:*\n\`\`\`${error.stack}\`\`\``;

    console.error("[SYSTEM ERROR]", error);
    await sendToAdmin(sock, { text: errorMessage, mentions: [sender] });
}

// =======================================================
// 🚀 INÍCIO DO BOT (LIMAX ENGINE PRO)
// =======================================================
async function startBot() {
    console.log("\x1b[36m[INICIANDO]\x1b[0m Carregando credenciais...");
    const { state, saveCreds } = await useMultiFileAuthState("auth_iris");

    console.log("\x1b[36m[INICIANDO]\x1b[0m Buscando versão do WhatsApp...");
    const { version } = await fetchLatestBaileysVersion();
    console.log(`\x1b[32m[SISTEMA]\x1b[0m Usando WA versão: ${version.join('.')}`);

    const sock = makeWASocket({
        version,
        logger: P({ level: "silent" }),
        printQRInTerminal: !usePairingCode,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, P({ level: "silent" })),
        },
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        markOnlineOnConnect: true,
        defaultQueryTimeoutMs: undefined
    });

    console.log("\x1b[33m[SISTEMA]\x1b[0m Servidor Socket Inicializado.");

    sock.copyNForward = async (jid, message, forceForward = false, options = {}) => {
        let vtype;
        if (options.readViewOnce) {
            message.message = message.message && message.message.viewOnceMessageV2 && message.message.viewOnceMessageV2.message ? message.message.viewOnceMessageV2.message : (message.message && message.message.viewOnceMessage && message.message.viewOnceMessage.message ? message.message.viewOnceMessage.message : message.message)
            vtype = Object.keys(message.message)[0]
            delete message.message.viewOnceMessageV2
            delete message.message[vtype].viewOnce
            message.message = { ...message.message }
        }
        let type = Object.keys(message.message)[0]
        let content = message.message[type]
        if (type == 'viewOnceMessageV2') {
            content = message.message.viewOnceMessageV2.message
            type = Object.keys(content)[0]
        }
        let contextInfo = {}
        if (type == 'extendedTextMessage') contextInfo = content.contextInfo
        message.message[type].contextInfo = { ...contextInfo, ...options.contextInfo }
        const waMessage = await Baileys.generateWAMessageFromContent(jid, message.message, { userJid: sock.user.id, ...options })
        await sock.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id })
        return waMessage
    }

    sock.ev.on("creds.update", saveCreds);

    if (usePairingCode && !state.creds.registered) {
        console.log("\x1b[33m[SISTEMA]\x1b[0m Gerando Código de Pareamento...");
        const cleanNumber = botNumber.replace(/\D/g, '');
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(cleanNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log("\n\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m");
                console.log(`\x1b[1;33m📱 SEU CÓDIGO [${BOT_NAME}]: \x1b[1;32m${formattedCode || "NÃO GERADO"}\x1b[0m`);
                console.log("\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n");
                addLog(`Pairing Code: ${formattedCode}`);
            } catch (error) {
                console.error("❌ Erro Pairing Code:", error);
            }
        }, 3000);
    }

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) console.log("\x1b[33m[SISTEMA]\x1b[0m QR Code gerado. Escaneie no WhatsApp.");
        if (connection === "connecting") console.log("\x1b[33m[SISTEMA]\x1b[0m Estabelecendo conexão...");
        if (connection === "open") {
            console.log("\n\x1b[1;32m" + "=".repeat(40));
            console.log(`🟢 [ONLINE] ${BOT_NAME} CONECTADO!`);
            console.log("=".repeat(40) + "\x1b[0m\n");
            addLog("Sistema Online");
            await sendToAdmin(sock, `😈 *${BOT_NAME} ONLINE*`);
        }
        if (connection === "close") {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`\x1b[31m[ERRO]\x1b[0m Conexão encerrada. Motivo: ${reason}`);
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("\x1b[33m[SISTEMA]\x1b[0m Reiniciando em 5 segundos...");
                setTimeout(startBot, 5000);
            }
        }
    });

    sock.ev.on("group-participants.update", async (update) => {
        const { id, participants, action } = update;
        if (action === "add" && db.groups[id]?.welcome) {
            const groupMetadata = await sock.groupMetadata(id).catch(() => null);
            const groupName = groupMetadata?.subject || "Grupo";
            for (const p of participants) {
                const text = `👋 *BEM-VINDO(A)* @${p.split('@')[0]} ao grupo *${groupName}*!\n\nUse *.menu* para ver meus comandos.`;
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
                const messageType = getContentType(msg.message);
                const msgId = msg.key.id;
                const sender = msg.key.participant || msg.key.remoteJid;

                if (!db.users[sender]) db.users[sender] = { xp: 0, level: 1, warns: 0, blacklist: false, whitelist: false };
                const isOwner = sender.includes(adminNumber.split('@')[0]) || msg.key.fromMe;

                if (db.users[sender].blacklist && !isOwner && !db.users[sender].whitelist) return;

                db.stats.messages++;

                if (messageType !== 'protocolMessage') {
                    msgCache.set(msgId, msg);
                    if (msgCache.size > 1000) msgCache.delete(msgCache.keys().next().value);
                }

                if (messageType === 'protocolMessage' && msg.message.protocolMessage?.key) {
                    await handleAntiDelete(sock, msg);
                    continue;
                }

                const viewOnce = msg.message?.viewOnceMessageV2?.message || msg.message?.viewOnceMessage?.message;
                if (viewOnce) await handleAutoReveal(sock, msg, viewOnce);

                const body = (
                    (messageType === "conversation" ? msg.message.conversation :
                        messageType === "extendedTextMessage" ? msg.message.extendedTextMessage?.text :
                            messageType === "imageMessage" ? msg.message.imageMessage?.caption :
                                messageType === "videoMessage" ? msg.message.videoMessage?.caption : "") || ""
                ).trim();

                // DEBUG LOG - Ver recepção de mensagens
                console.log("[DEBUG] Mensagem recebida:", JSON.stringify(msg.message, null, 2));
                console.log("[DEBUG] Texto extraído:", body);

                if (!body) continue;

                db.users[sender].xp += Math.floor(Math.random() * 10) + 5;
                const nextLevel = db.users[sender].level * 500;
                if (db.users[sender].xp >= nextLevel) {
                    db.users[sender].level++;
                    if (!msg.key.fromMe) await sock.sendMessage(from, { text: `🎉 *PARABÉNS* @${sender.split('@')[0]}! Nível *${db.users[sender].level}*!`, mentions: [sender] });
                }

                if (isGroup && db.groups[from]?.replies?.[body.toLowerCase()]) {
                    await sock.sendMessage(from, { text: db.groups[from].replies[body.toLowerCase()] });
                }

                const isCmd = body.startsWith(PREFIX);
                const args = isCmd ? body.slice(PREFIX.length).trim().split(/ +/) : body.trim().split(/ +/);
                const command = args.shift().toLowerCase();
                const q = command;
                const fullText = args.join(" ");

                const groupMetadata = isGroup ? await sock.groupMetadata(from).catch(() => null) : null;
                const participants = groupMetadata ? groupMetadata.participants : [];
                const admins = participants.filter(p => p.admin).map(p => p.id);
                const isAdmins = admins.includes(sender);
                const isBotAdmins = admins.map(a => a.split('@')[0].replace(/\D/g, '')).includes(botNumber.replace(/\D/g, ''));

                if (!isCmd && !["kkkk", "kkk", "kk", "k", "perai"].includes(q)) continue;

                db.stats.commands++;
                addLog(`Cmd: ${command} de ${sender}`);

                // 🎯 RECOURSIVE TRY/CATCH PARA ERROS DISCRETOS
                try {
                    switch (q) {
                        case "menu": {
                            const sub = args[0]?.toLowerCase();
                            if (sub === "private") {
                                if (!isOwner) return;
                                const h = Math.floor(process.uptime() / 3600);
                                const m = Math.floor((process.uptime() % 3600) / 60);
                                const privateMenu = `🔐 *${BOT_NAME} // ADMIN ROOT PANEL*\n\n` +
                                    `Acesso autorizado.\n\n` +
                                    `⚙️ *CONTROLE GLOBAL*\n` +
                                    `├ .block [num] - Bloqueia real\n` +
                                    `├ .unblock [num] - Desbloqueio real\n` +
                                    `├ .blocklist - Lista bloqueados\n` +
                                    `├ .broadcast [msg] - Aviso global\n\n` +
                                    `🧠 *CONTROLE DE SISTEMA*\n` +
                                    `├ .whitelist - Lista whitelist\n` +
                                    `├ .blacklist - Lista blacklist\n` +
                                    `├ .addwhitelist / .delwhitelist\n` +
                                    `├ .addblacklist / .delblacklist\n` +
                                    `├ .logs / .memory / .uptime\n` +
                                    `└ .forcerestart / .fullclear / .resetuser\n\n` +
                                    `Esse painel só funciona no número administrador.\n` +
                                    `━━━━━━━━━━━━━━━━━━━`;
                                return await sock.sendMessage(from, { text: privateMenu });
                            }
                            if (sub === "all") {
                                const allMenu = `📚 *${BOT_NAME} COMPENDIUM - MANUAL COMPLETO*\n\n` +
                                    `📸 *REVELAR MÍDIA*\n` +
                                    `.ver / .explanar → Revela visualização única.\n` +
                                    `kkk / perai → Atalhos rápidos para revelar.\n\n` +
                                    `🔨 *MODERAÇÃO*\n` +
                                    `.ban / .promote / .demote\n` +
                                    `.warn / .mute / .unmute\n` +
                                    `.clear [n] / .tagall\n\n` +
                                    `⚙️ *SISTEMA & PROTEÇÃO*\n` +
                                    `.system config / .antilink\n` +
                                    `.antimedia / .welcome / .captcha\n\n` +
                                    `🎭 *INTERAÇÃO & XP*\n` +
                                    `.addreply / .delreply / .listreply\n` +
                                    `.rank / .level / .xp\n\n` +
                                    `🎰 *UTILITÁRIOS*\n` +
                                    `.sorteio / .enquete / .stats\n` +
                                    `.vercache / .cleancache\n\n` +
                                    `━━━━━━━━━━━━━━━━━━━`;
                                return await sock.sendMessage(from, { text: allMenu });
                            }
                            const menu = `🚀 *${BOT_NAME} AUTORIDADE* 🚀\n\n` +
                                `📸 *REVELAR MÍDIA*\n├ .ver / .explanar / kkk / perai\n\n` +
                                `🔨 *MODERAÇÃO*\n├ .ban / .promote / .demote\n├ .mute / .unmute / .clear\n\n` +
                                `⚙️ *SISTEMA & PROTEÇÃO*\n├ .system config / .antilink\n├ .welcome / .captcha\n\n` +
                                `🎭 *INTERAÇÃO & XP*\n├ .addreply / .delreply / .listreply\n├ .rank / .level / .xp\n\n` +
                                `🎰 *UTILITÁRIOS*\n├ .sorteio / .enquete / .stats\n├ .vercache / .cleancache\n\n` +
                                `🔐 *EXCLUSIVO ADMIN*\n└ .menu private\n\n` +
                                `━━━━━━━━━━━━━━━━━━━`;
                            return await sock.sendMessage(from, { text: menu });
                        }

                        case "block": {
                            if (!isOwner) return;
                            if (!args[0]) {
                                const list = await sock.fetchBlocklist().catch(() => []);
                                if (list.length === 0) return await sock.sendMessage(from, { text: "🚫 Ninguém bloqueado no WhatsApp." });
                                let txt = `🚫 *LISTA DE BLOQUEADOS (WhatsApp)*\n\n`;
                                list.forEach(j => txt += `├ @${j.split('@')[0]}\n`);
                                return await sock.sendMessage(from, { text: txt, mentions: list });
                            }
                            const target = args[0]?.includes('@') ? args[0] : args[0]?.replace(/\D/g, '') + '@s.whatsapp.net';
                            await sock.updateBlockStatus(target, "block");
                            return await sock.sendMessage(from, { text: `✅ Bloqueado: ${target.split('@')[0]}` });
                        }
                        case "unblock": {
                            if (!isOwner) return;
                            const target = args[0]?.includes('@') ? args[0] : args[0]?.replace(/\D/g, '') + '@s.whatsapp.net';
                            if (!args[0]) return;
                            await sock.updateBlockStatus(target, "unblock");
                            return await sock.sendMessage(from, { text: `✅ Desbloqueado: ${target.split('@')[0]}` });
                        }
                        case "blocklist": {
                            if (!isOwner) return;
                            const list = await sock.fetchBlocklist().catch(() => []);
                            if (list.length === 0) return await sock.sendMessage(from, { text: "🚫 Ninguém bloqueado no WhatsApp." });
                            let txt = `🚫 *LISTA DE BLOQUEADOS (WhatsApp)*\n\n`;
                            list.forEach(j => txt += `├ @${j.split('@')[0]}\n`);
                            return await sock.sendMessage(from, { text: txt, mentions: list });
                        }
                        case "whitelist": {
                            if (!isOwner) return;
                            const list = Object.keys(db.users).filter(u => db.users[u].whitelist);
                            if (list.length === 0) return await sock.sendMessage(from, { text: "⚪ Whitelist vazia." });
                            let txt = `⚪ *LISTA WHITELIST*\n\n`;
                            list.forEach(u => txt += `├ @${u.split('@')[0]}\n`);
                            return await sock.sendMessage(from, { text: txt, mentions: list });
                        }
                        case "blacklist": {
                            if (!isOwner) return;
                            const list = Object.keys(db.users).filter(u => db.users[u].blacklist);
                            if (list.length === 0) return await sock.sendMessage(from, { text: "🔒 Blacklist vazia." });
                            let txt = `🔒 *LISTA BLACKLIST*\n\n`;
                            list.forEach(u => txt += `├ @${u.split('@')[0]}\n`);
                            return await sock.sendMessage(from, { text: txt, mentions: list });
                        }
                        case "addwhitelist": {
                            if (!isOwner) return;
                            const target = args[0]?.includes('@') ? args[0] : args[0]?.replace(/\D/g, '') + '@s.whatsapp.net';
                            if (target) {
                                if (!db.users[target]) db.users[target] = { xp: 0, level: 1, warns: 0, blacklist: false, whitelist: false };
                                db.users[target].whitelist = true;
                            }
                            return await sock.sendMessage(from, { text: "⚪ Whitelist: OK." });
                        }
                        case "delwhitelist": {
                            if (!isOwner) return;
                            const target = args[0]?.includes('@') ? args[0] : args[0]?.replace(/\D/g, '') + '@s.whatsapp.net';
                            if (db.users[target]) db.users[target].whitelist = false;
                            return await sock.sendMessage(from, { text: "⚫ Whitelist: REM." });
                        }
                        case "addblacklist": {
                            if (!isOwner) return;
                            const target = args[0]?.includes('@') ? args[0] : args[0]?.replace(/\D/g, '') + '@s.whatsapp.net';
                            if (target) {
                                if (!db.users[target]) db.users[target] = { xp: 0, level: 1, warns: 0, blacklist: false, whitelist: false };
                                db.users[target].blacklist = true;
                            }
                            return await sock.sendMessage(from, { text: "🔒 Blacklist: OK." });
                        }
                        case "delblacklist": {
                            if (!isOwner) return;
                            const target = args[0]?.includes('@') ? args[0] : args[0]?.replace(/\D/g, '') + '@s.whatsapp.net';
                            if (db.users[target]) db.users[target].blacklist = false;
                            return await sock.sendMessage(from, { text: "🔓 Blacklist: REM." });
                        }
                        case "forcerestart": {
                            if (!isOwner) return;
                            await sock.sendMessage(from, { text: "🔄 Reiniciando..." });
                            process.exit(1);
                        }
                        case "logs": case "log": {
                            if (!isOwner) return;
                            return await sock.sendMessage(from, { text: `📋 LOGS:\n${db.logs.join("\n")}` });
                        }
                        case "broadcast": {
                            if (!isOwner) return;
                            const groups = Object.keys(await sock.groupFetchAllParticipating());
                            for (let g of groups) { await sock.sendMessage(g, { text: `📢 ${fullText}` }); await delay(1000); }
                            break;
                        }
                        case "ban": {
                            if (!isGroup || (!isAdmins && !isOwner) || !isBotAdmins) return;
                            const target = msg.message.extendedTextMessage?.contextInfo?.participant || msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                            if (target) await sock.groupParticipantsUpdate(from, [target], "remove");
                            break;
                        }
                        case "promote": {
                            if (!isGroup || (!isAdmins && !isOwner) || !isBotAdmins) return;
                            const target = msg.message.extendedTextMessage?.contextInfo?.participant || msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                            if (target) await sock.groupParticipantsUpdate(from, [target], "promote");
                            break;
                        }
                        case "demote": {
                            if (!isGroup || (!isAdmins && !isOwner) || !isBotAdmins) return;
                            const target = msg.message.extendedTextMessage?.contextInfo?.participant || msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                            if (target) await sock.groupParticipantsUpdate(from, [target], "demote");
                            break;
                        }
                        case "mute": {
                            if (!isGroup || !isBotAdmins || !isAdmins) return;
                            await sock.groupSettingUpdate(from, 'announcement');
                            break;
                        }
                        case "unmute": {
                            if (!isGroup || !isBotAdmins || !isAdmins) return;
                            await sock.groupSettingUpdate(from, 'not_announcement');
                            break;
                        }
                        case "clear": {
                            if (!isGroup || (!isAdmins && !isOwner)) return;
                            const num = parseInt(args[0]) || 10;
                            const msgs = Array.from(msgCache.values()).filter(m => m.key.remoteJid === from).slice(-(num + 1));
                            for (const m of msgs) { try { await sock.sendMessage(from, { delete: m.key }); await delay(500); } catch (e) { } }
                            break;
                        }
                        case "tagall": {
                            if (!isGroup || (!isAdmins && !isOwner)) return;
                            const jids = participants.map(p => p.id);
                            await sock.sendMessage(from, { text: `📢 CHAMADA:\n${jids.map(j => `@${j.split('@')[0]}`).join(" ")}`, mentions: jids });
                            break;
                        }
                        case "addreply": {
                            if (!isGroup || (!isAdmins && !isOwner)) return;
                            if (!db.groups[from]) db.groups[from] = { replies: {} };
                            const parts = fullText.split("|");
                            if (parts.length < 2) return await sock.sendMessage(from, { text: "❌ Use: .addreply gatilho | resposta" });
                            db.groups[from].replies[parts[0].trim().toLowerCase()] = parts[1].trim();
                            return await sock.sendMessage(from, { text: "✅ Resposta cadastrada!" });
                        }
                        case "delreply": {
                            if (!isGroup || (!isAdmins && !isOwner)) return;
                            const trigger = fullText.trim().toLowerCase();
                            if (!db.groups[from]?.replies?.[trigger]) return await sock.sendMessage(from, { text: "❌ Gatilho não encontrado." });
                            delete db.groups[from].replies[trigger];
                            return await sock.sendMessage(from, { text: `🗑️ Removido: "${trigger}"` });
                        }
                        case "listreply": {
                            if (!isGroup) return;
                            const reps = Object.keys(db.groups[from]?.replies || {});
                            if (reps.length === 0) return await sock.sendMessage(from, { text: "❌ Nenhuma resposta cadastrada." });
                            return await sock.sendMessage(from, { text: `📋 *RESPOSTAS DO GRUPO*\n\n${reps.join("\n")}` });
                        }
                        case "system": {
                            if (args[0] === "config") {
                                const g = db.groups[from] || {};
                                return await sock.sendMessage(from, { text: `⚙️ CONFIG:\nAntilink: ${g.antilink ? "V" : "X"}\nWelcome: ${g.welcome ? "V" : "X"}` });
                            }
                            break;
                        }
                        case "antilink": case "antimedia": case "captcha": case "welcome": {
                            if (!isGroup || (!isAdmins && !isOwner)) return;
                            if (!db.groups[from]) db.groups[from] = { replies: {} };
                            db.groups[from][q] = args[0] === "on";
                            return await sock.sendMessage(from, { text: `🛡️ ${q}: ${args[0] === "on" ? "ON" : "OFF"}` });
                        }
                        case "level": case "xp": {
                            const u = db.users[sender];
                            return await sock.sendMessage(from, { text: `📊 Lvl: ${u.level} | XP: ${u.xp}` });
                        }
                        case "rank": {
                            const sorted = Object.entries(db.users).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
                            let txt = `🏆 TOP 10:\n`;
                            sorted.forEach((u, i) => txt += `${i + 1}º - @${u[0].split('@')[0]} (Lvl ${u[1].level})\n`);
                            return await sock.sendMessage(from, { text: txt, mentions: sorted.map(u => u[0]) });
                        }
                        case "sorteio": {
                            const win = participants[Math.floor(Math.random() * participants.length)].id;
                            return await sock.sendMessage(from, { text: `🎉 @${win.split('@')[0]}`, mentions: [win] });
                        }
                        case "enquete": {
                            const p = fullText.split("|");
                            if (p.length < 3) return;
                            return await sock.sendMessage(from, { poll: { name: p[0].trim(), values: p.slice(1).map(v => v.trim()), selectableCount: 1 } });
                        }
                        case "stats": {
                            return await sock.sendMessage(from, { text: `📈 Msgs: ${db.stats.messages}` });
                        }
                        case "memory": {
                            return await sock.sendMessage(from, { text: `📦 RAM: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB` });
                        }
                        case "uptime": {
                            return await sock.sendMessage(from, { text: `⏳ Online: ${Math.floor(process.uptime() / 3600)}h` });
                        }
                        case "cleancache": {
                            if (!isOwner) return;
                            msgCache.clear();
                            return await sock.sendMessage(from, { text: "🧹 Cache limpo!" });
                        }
                        case "vercache": {
                            if (!isOwner) return;
                            return await sock.sendMessage(from, { text: `🛡️ Cache: ${msgCache.size}` });
                        }
                        case "ver": case "explanar": case "kkkk": case "kkk": case "kk": case "k": case "perai": {
                            await handleRevealMedia(sock, msg);
                            break;
                        }
                        default: break;
                    }
                } catch (cmdErr) {
                    await handleError(sock, cmdErr, { command: q, sender, from, isGroup });
                }

            } catch (err) { console.error("[FATAL UPSERT]", err); }
        }
    });
}

// =======================================================
// 🛡️ FUNÇÕES AUXILIARES AJUSTADAS (PRIVACY MODE)
// =======================================================
async function handleAntiDelete(sock, msg) {
    const protocolMessage = msg.message.protocolMessage;
    const targetId = protocolMessage.key.id;
    try {
        const deletedMsg = msgCache.get(targetId);
        if (deletedMsg) {
            const realSender = deletedMsg.key.participant || deletedMsg.key.remoteJid;
            const originalType = getContentType(deletedMsg.message);
            let content = originalType === 'conversation' ? deletedMsg.message.conversation : (originalType === 'extendedTextMessage' ? deletedMsg.message.extendedTextMessage.text : `[${originalType}]`);
            const response = `*🕵️ MENSAGEM APAGADA*\n👤 @${realSender.split('@')[0]}\n💬 ${content}`;
            await sendToAdmin(sock, { text: response, mentions: [realSender] });
            if (!['conversation', 'extendedTextMessage'].includes(originalType)) {
                await sock.copyNForward(adminNumber, deletedMsg, false).catch(() => { });
            }
        }
    } catch (e) { }
}

async function handleRevealMedia(sock, msg) {
    console.log("[REVEAL] Iniciando...");

    try {
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        let target = contextInfo?.quotedMessage || msg.message;

        if (!target) {
            console.log("[REVEAL] Nenhuma quotedMessage.");
            return;
        }

        // REMOVE TODAS AS CAMADAS viewOnce recursivamente
        while (target?.viewOnceMessageV2 || target?.viewOnceMessage) {
            target = target.viewOnceMessageV2?.message || target.viewOnceMessage?.message;
        }

        const type = getContentType(target);
        console.log("[REVEAL] Tipo detectado:", type);

        if (!type) {
            console.log("[REVEAL] Tipo indefinido.");
            return;
        }

        const stream = await downloadContentFromMessage(
            target[type],
            type.replace("Message", "")
        );

        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        console.log("[REVEAL] Buffer:", buffer.length);

        if (!buffer || buffer.length === 0) {
            console.log("[REVEAL] Buffer vazio.");
            return;
        }

        if (type === "imageMessage") {
            await sendToAdmin(sock, {
                image: buffer,
                caption: "💀 Revelado"
            });
        }

        else if (type === "videoMessage") {
            await sendToAdmin(sock, {
                video: buffer,
                caption: "💀 Revelado"
            });
        }

        else if (type === "audioMessage") {
            await sendToAdmin(sock, {
                audio: buffer,
                mimetype: target[type].mimetype || "audio/ogg",
                ptt: target[type].ptt || false
            });
        }

        console.log("[REVEAL] Enviado para admin.");

    } catch (err) {
        console.error("[REVEAL ERROR]", err);
        await sendToAdmin(sock, "❌ Erro ao revelar mídia: " + err.message);
    }
}

async function handleAutoReveal(sock, msg, vMsg) {
    try {
        const sender = msg.key.participant || msg.key.remoteJid;
        const type = getContentType(vMsg);
        const streamType = type.replace('Message', '');
        const stream = await downloadContentFromMessage(vMsg[type], streamType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        const cap = `👁️ *VIEW-ONCE* de @${sender.split('@')[0]}`;
        if (streamType === 'image') await sendToAdmin(sock, { image: buffer, caption: cap, mentions: [sender] });
        else if (streamType === 'video') await sendToAdmin(sock, { video: buffer, caption: cap, mentions: [sender] });
        else if (streamType === 'audio') await sendToAdmin(sock, { audio: buffer, mimetype: 'audio/mpeg', ptt: true });
    } catch (e) { }
}

startBot();
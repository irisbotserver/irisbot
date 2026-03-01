const { downloadContentFromMessage, delay, generateWAMessageFromContent } = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");

class BotHandler {
    constructor(sock, tenant) {
        this.sock = sock;
        this.tenant = tenant;
        this.config = typeof tenant.config === "string" ? JSON.parse(tenant.config) : (tenant.config || { prefix: ".", botName: "Iris", adminNumber: "" });
        this.msgCache = new Map();
        this.db = { stats: { messages: 0, commands: 0 }, users: {}, groups: {} };
        const cleanAdmin = this.tenant.adminNumber ? this.tenant.adminNumber.replace(/\D/g, "") : "";
        this.adminJid = cleanAdmin ? `${cleanAdmin}@s.whatsapp.net` : "";
    }

    async handle(msg) {
        try {
            if (!msg.message) return;
            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const messageType = Object.keys(msg.message)[0];
            const msgId = msg.key.id;
            const sender = msg.key.participant || msg.key.remoteJid;

            // Admin identification - more robust check
            const cleanSender = sender.replace(/\D/g, "");
            const isOwner = (this.tenant.adminNumber && cleanSender.includes(this.tenant.adminNumber.replace(/\D/g, ""))) || msg.key.fromMe;

            this.db.stats.messages++;

            // Mídia Cache para Anti-Delete e Reveal
            if (messageType !== 'protocolMessage') {
                this.msgCache.set(msgId, msg);
                if (this.msgCache.size > 1000) this.msgCache.delete(this.msgCache.keys().next().value);
            }

            // Anti-Delete logic
            if (messageType === 'protocolMessage' && msg.message.protocolMessage?.key) {
                await this.handleAntiDelete(msg);
                return;
            }

            // Auto-Reveal ViewOnce
            const viewOnce = msg.message?.viewOnceMessageV2?.message || msg.message?.viewOnceMessage?.message;
            if (viewOnce) {
                await this.handleAutoReveal(msg, viewOnce);
            }

            // Body extraction
            const body = (
                (messageType === "conversation" ? msg.message.conversation :
                    messageType === "extendedTextMessage" ? msg.message.extendedTextMessage?.text :
                        messageType === "imageMessage" ? msg.message.imageMessage?.caption :
                            messageType === "videoMessage" ? msg.message.videoMessage?.caption : "") || ""
            ).trim();

            if (!body) return;

            const args = body.split(/ +/);
            const command = args[0].toLowerCase();
            const textAfter = body.slice(command.length).trim();
            const prefix = this.config.prefix || ".";
            const isCmd = body.startsWith(prefix);
            const q = isCmd ? command.slice(prefix.length) : command;

            // Group Permissions
            let isAdmins = false;
            let isBotAdmins = false;
            if (isGroup) {
                const metadata = await this.sock.groupMetadata(from).catch(() => null);
                if (metadata) {
                    const participants = metadata.participants;
                    const admins = participants.filter(p => p.admin).map(p => p.id);
                    isAdmins = admins.includes(sender);
                    isBotAdmins = admins.includes(this.sock.user.id.split(":")[0] + "@s.whatsapp.net");
                }
            }

            // COMMANDS
            if (isCmd) {
                this.db.stats.commands++;

                if (q === "menu") {
                    const menu = `🚀 *${this.config.botName || "IRIS"} - ENGINE* 🚀\n\n` +
                        `📸 *REVELAR MÍDIA*\n` +
                        `├ .ver / .explanar \n` +
                        `└ (Auto-Reveal Ativo)\n\n` +
                        `🔨 *MODERAÇÃO*\n` +
                        `├ .ban / .promote / .demote\n` +
                        `├ .clear [n] / .tagall\n\n` +
                        `⚙️ *SISTEMA*\n` +
                        `├ .ping / .id\n` +
                        `└ .stats\n\n` +
                        `━━━━━━━━━━━━━━━━━━━`;
                    return await this.sock.sendMessage(from, { text: menu });
                }

                if (q === "ping") return await this.sock.sendMessage(from, { text: "🏓 Pong!" });
                if (q === "id") return await this.sock.sendMessage(from, { text: `🆔 ID: ${sender}` });

                if (q === "stats") {
                    return await this.sock.sendMessage(from, { text: `📊 *STATS*\n💬 Msg: ${this.db.stats.messages}\n🛠️ Cmd: ${this.db.stats.commands}` });
                }

                if (q === "clear" && isGroup) {
                    if (!isAdmins && !isOwner) return await this.sock.sendMessage(from, { text: "❌ Sem permissão." });
                    const num = parseInt(args[1]) || 10;
                    const msgs = Array.from(this.msgCache.values())
                        .filter(m => m.key.remoteJid === from)
                        .slice(-(num + 1));
                    for (const m of msgs) {
                        try { await this.sock.sendMessage(from, { delete: m.key }); await delay(500); } catch (e) { }
                    }
                    return;
                }

                if (q === "ban" && isGroup && isBotAdmins) {
                    if (!isAdmins && !isOwner) return;
                    const target = msg.message.extendedTextMessage?.contextInfo?.participant || msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (target) await this.sock.groupParticipantsUpdate(from, [target], "remove");
                }

                if (q === "ver" || q === "explanar") {
                    await this.handleRevealMedia(msg);
                }
            }

            // Auto-responses or triggers
            if (["kkk", "perai"].includes(body.toLowerCase())) {
                await this.handleRevealMedia(msg);
            }

        } catch (err) {
            console.error(`[BOT ERR] Tenant ${this.tenant.id}:`, err);
        }
    }

    async handleAntiDelete(msg) {
        const protocolMessage = msg.message.protocolMessage;
        const targetId = protocolMessage.key.id;
        try {
            await delay(1000);
            const deletedMsg = this.msgCache.get(targetId);
            if (deletedMsg && this.adminJid) {
                const realSender = deletedMsg.key.participant || deletedMsg.key.remoteJid;
                const originalType = Object.keys(deletedMsg.message)[0];
                let content = originalType === 'conversation' ? deletedMsg.message.conversation : (originalType === 'extendedTextMessage' ? deletedMsg.message.extendedTextMessage.text : `[${originalType}]`);
                const response = `*🕵️ ANTIDELETE*\n👤 @${realSender.split('@')[0]}\n💬 ${content}`;
                await this.sock.sendMessage(this.adminJid, { text: response, mentions: [realSender] });
            }
        } catch (e) { }
    }

    async handleAutoReveal(msg, vMsg) {
        try {
            if (!this.adminJid) return;
            const sender = msg.key.participant || msg.key.remoteJid;
            const type = Object.keys(vMsg)[0];
            const streamType = type.replace('Message', '');
            const stream = await downloadContentFromMessage(vMsg[type], streamType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            const cap = `👁️ *VIEW-ONCE* de @${sender.split('@')[0]}`;
            if (streamType === 'image') await this.sock.sendMessage(this.adminJid, { image: buffer, caption: cap, mentions: [sender] });
            else if (streamType === 'video') await this.sock.sendMessage(this.adminJid, { video: buffer, caption: cap, mentions: [sender] });
        } catch (e) { }
    }

    async handleRevealMedia(msg) {
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
            if (streamType === 'image') await this.sock.sendMessage(msg.key.remoteJid, { image: buffer, caption: `💀 Revelado.` });
            else if (streamType === 'video') await this.sock.sendMessage(msg.key.remoteJid, { video: buffer, caption: `💀 Revelado.` });
        } catch (e) { }
    }
}

module.exports = BotHandler;

const { DisconnectReason } = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { PrismaClient } = require("@prisma/client");

// CARREGAMENTO DO RUNTIME LEGACY (MÉTODO START_INSTANCE)
const { startInstance } = require("./bot-manager-v10");

/**
 * PRODUCTION BOT MANAGER - ARCHITECTURE V10 (LEGACY INTEGRATION)
 * Gerencia o ciclo de vida de múltiplas instâncias usando a lógica original do index.js.
 */
class BotManager extends EventEmitter {
    constructor() {
        super();
        this.activeNodes = new Map(); // instanceId -> { sock, status }
        this.bootLocks = new Set();
        this.prisma = new PrismaClient();
        this.instancesRootDir = path.resolve(__dirname, "..", "instances");

        if (!fs.existsSync(this.instancesRootDir)) {
            fs.mkdirSync(this.instancesRootDir, { recursive: true });
        }
    }

    async init() {
        console.log("\n[SYSTEM] [BOOT] Restaurando instâncias configuradas...");
        const instances = await this.prisma.instance.findMany({
            where: { status: "active" },
            include: { user: { include: { licenses: true } } }
        });

        for (const inst of instances) {
            const license = inst.user.licenses.find(l => l.status === "ACTIVE" && (!l.expiresAt || l.expiresAt > new Date()));
            if (license) {
                this.startBot(inst.id).catch(e => console.error(`[RESTORE_ERR] [${inst.id}]`, e.message));
            } else {
                await this.prisma.instance.update({ where: { id: inst.id }, data: { status: "inactive" } });
            }
        }
    }

    async startBot(instanceId) {
        if (this.bootLocks.has(instanceId)) return;

        const existingNode = this.activeNodes.get(instanceId);
        if (existingNode && existingNode.status === 'CONNECTED') return;

        this.bootLocks.add(instanceId);

        try {
            const instance = await this.prisma.instance.findUnique({
                where: { id: instanceId }
            });

            if (!instance) throw new Error("Instância inexistente.");

            // Configuração para o Runtime V10
            const config = {
                uuid: instanceId,
                botName: instance.name || "IRIS",
                adminNumber: instance.adminNumber,
                botNumber: instance.botNumber,
                usePairingCode: instance.pairingType === "CODE",
                prefix: "." // Ou extrair do config do banco
            };

            console.log(`[MANAGER] [${instanceId}] Disparando Runtime V10...`);
            const sock = await startInstance(config);

            this.activeNodes.set(instanceId, { sock, status: 'CONNECTED' });

            // Repasse de eventos para o frontend (via SocketServer) e sincronização DB
            sock.ev.on("connection.update", async (update) => {
                const { connection, qr, pairingCode } = update;

                if (qr) {
                    this.emit("qr", { instanceId, qr });
                    await this.prisma.instance.update({ where: { id: instanceId }, data: { lastQR: qr, pairingCode: null } }).catch(() => { });
                }

                if (pairingCode) {
                    this.emit("status", { instanceId, status: "PAIRING", pairingCode });
                    await this.prisma.instance.update({ where: { id: instanceId }, data: { pairingCode, lastQR: null } }).catch(() => { });
                }

                if (connection === "open") {
                    console.log(`[MANAGER] [${instanceId}] INSTÂNCIA CONECTADA NO WHATSAPP`);
                    this.emit("status", { instanceId, status: "CONNECTED" });
                    await this.prisma.instance.update({
                        where: { id: instanceId },
                        data: { connection: "CONNECTED", status: "active", lastQR: null, pairingCode: null }
                    }).catch(() => { });
                }

                if (connection === "close") {
                    console.log(`[MANAGER] [${instanceId}] INSTÂNCIA DESCONECTADA`);
                    this.activeNodes.delete(instanceId);
                    this.emit("status", { instanceId, status: "DISCONNECTED" });
                    await this.prisma.instance.update({
                        where: { id: instanceId },
                        data: { connection: "DISCONNECTED", status: "inactive" }
                    }).catch(() => { });
                }
            });

            sock.ev.on("status", (data) => this.emit("status", { instanceId, ...data }));

        } catch (e) {
            console.error(`[MANAGER_ERR] [${instanceId}]`, e.stack);
        } finally {
            this.bootLocks.delete(instanceId);
        }
    }

    async stopBot(instanceId) {
        console.log(`[STOP] [${instanceId}]`);
        const node = this.activeNodes.get(instanceId);
        if (node?.sock) {
            try {
                node.sock.ev.removeAllListeners();
                node.sock.ws.close();
                await node.sock.end();
            } catch (e) { }
        }
        this.activeNodes.delete(instanceId);
        await this.prisma.instance.update({
            where: { id: instanceId },
            data: { connection: "DISCONNECTED", status: "inactive", lastQR: null, pairingCode: null }
        });
    }
}

module.exports = new BotManager();

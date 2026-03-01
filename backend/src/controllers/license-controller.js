const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const prisma = new PrismaClient();

exports.getLicenses = async (req, res) => {
    try {
        console.log(`[LICENSES] Fetching for user: ${req.user.email} (Role: ${req.user.role})`);
        const licenses = req.user.role === "ADMIN"
            ? await prisma.license.findMany({ include: { user: true } })
            : await prisma.license.findMany({ where: { boundUserId: req.user.id } });
        console.log(`[LICENSES] Found ${licenses.length} items`);
        res.json(licenses);
    } catch (e) {
        console.error("[LICENSES_ERROR]", e);
        res.status(500).json({ error: e.message });
    }
};

exports.generateLicense = async (req, res) => {
    console.log(`[LICENSE_GENERATE] Hit by: ${req.user.email}`);
    const { durationDays } = req.body;
    const key = "IRIS-" + crypto.randomBytes(8).toString("hex").toUpperCase();

    let days = parseInt(durationDays) || 30;

    try {
        console.log(`[LICENSE_GENERATE] Creating key: ${key} for ${days} days...`);
        const license = await prisma.license.create({
            data: {
                key,
                durationDays: days,
                status: "ACTIVE"
            }
        });
        console.log(`[LICENSE_GENERATE] Created ID: ${license.id}`);
        res.status(201).json(license);
    } catch (e) {
        console.error("[LICENSE_GENERATE_ERROR]", e);
        res.status(500).json({ error: "Failed to generate license.", details: e.message });
    }
};

exports.activateLicense = async (req, res) => {
    const { key } = req.body;
    const userId = req.user.id;

    try {
        const license = await prisma.license.findUnique({ where: { key } });

        if (!license) return res.status(404).json({ error: "Chave de licença não encontrada." });

        // SEGURANÇA MÁXIMA: Impede uso duplicado
        if (license.boundUserId) {
            return res.status(400).json({ error: "Esta licença já foi utilizada por outra conta." });
        }

        if (license.status !== "ACTIVE") {
            return res.status(400).json({ error: "Esta licença está desativada ou expirada." });
        }

        // Impede que o mesmo usuário tenha mais de uma licença ativa ao mesmo tempo
        const alreadyHasActive = await prisma.license.findFirst({
            where: {
                boundUserId: userId,
                status: "ACTIVE",
                expiresAt: { gt: new Date() }
            }
        });

        if (alreadyHasActive) {
            return res.status(400).json({ error: "Você já possui uma licença ativa em sua conta." });
        }

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + license.durationDays);

        const updated = await prisma.license.update({
            where: { id: license.id },
            data: {
                boundUserId: userId,
                activatedAt: new Date(),
                expiresAt: expiresAt
            }
        });

        res.json({ message: "Licença ativada com sucesso!", license: updated });
    } catch (e) {
        res.status(500).json({ error: "Erro interno ao ativar licença." });
    }
};

exports.deactivateLicense = async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.license.update({ where: { id }, data: { status: "REVOKED" } });
        res.json({ message: "License revoked." });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.reactivateLicense = async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.license.update({ where: { id }, data: { status: "ACTIVE" } });
        res.json({ message: "License reactivated." });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

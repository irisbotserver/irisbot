const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const dotenv = require("dotenv");
const { authenticate, isAdmin, hashPassword, comparePassword, generateToken } = require("./auth");
const { PrismaClient } = require("@prisma/client");
const botManager = require("./bot-manager");

const instanceController = require("./controllers/instance-controller");
const licenseController = require("./controllers/license-controller");

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// MIDDLEWARES
app.use(helmet({
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(cors({ origin: "*" }));
app.use(express.json());

// Health check route
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Request logging for debugging
app.use((req, res, next) => {
    console.log(`[REQ] ${req.method} ${req.url}`);
    next();
});

// Security: Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200, // Higher limit for dashboard interaction
    message: "Too many requests from this IP, please try again later."
});
app.use(limiter);

// --- AUTH ROUTES ---
app.post("/register", async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Missing email or password." });

    try {
        const hashedPassword = await hashPassword(password);
        const user = await prisma.user.create({
            data: { email: email.toLowerCase(), password: hashedPassword, name }
        });
        const token = generateToken({ id: user.id, email: user.email, role: user.role });
        res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
    } catch (e) {
        res.status(400).json({ error: "Email already exists." });
    }
});

app.post("/login", async (req, res) => {
    let { email, password } = req.body;
    email = email?.toLowerCase();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await comparePassword(password, user.password))) {
        return res.status(401).json({ error: "Invalid credentials." });
    }

    const token = generateToken({ id: user.id, email: user.email, role: user.role });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
});

app.get("/me", authenticate, async (req, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, email: true, name: true, role: true, createdAt: true }
    });
    res.json(user);
});

// --- INSTANCE ROUTES ---
app.post("/instances", authenticate, instanceController.createInstance);
app.get("/instances", authenticate, instanceController.getInstances);
app.get("/instances/:id", authenticate, instanceController.getInstanceStatus);
app.put("/instances/:id", authenticate, instanceController.updateInstance);
app.post("/instances/:id/start", authenticate, instanceController.startInstance);
app.post("/instances/:id/stop", authenticate, instanceController.stopInstance);
app.delete("/instances/:id", authenticate, instanceController.deleteInstance);

// --- LICENSE ROUTES ---
app.get("/licenses", authenticate, licenseController.getLicenses);
app.post("/licenses/activate", authenticate, licenseController.activateLicense);
app.post("/licenses/generate", authenticate, isAdmin, licenseController.generateLicense);
app.post("/licenses/:id/reactivate", authenticate, isAdmin, licenseController.reactivateLicense);
app.post("/licenses/:id/deactivate", authenticate, isAdmin, licenseController.deactivateLicense);

// --- ADMIN ROUTES ---
app.post("/admin/rotate-root-cipher", authenticate, isAdmin, async (req, res) => {
    const crypto = require("crypto");
    const newHash = "IRIS-" + crypto.randomBytes(16).toString("hex").toUpperCase();
    try {
        await prisma.user.updateMany({ data: { securityHash: newHash } });
        res.json({ message: "Security Hash rotated for all users.", newHash });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- INIT ---
// VERCEL COMPATIBILITY: Do NOT run app.listen or bot restoration in serverless environments.
if (process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'production') {
    app.listen(PORT, async () => {
        console.log(`[SERVER] Multi-Tenant IRIS API running on port ${PORT}`);
        try {
            await botManager.init();
            console.log("[SERVER] Active instances restored.");
        } catch (e) {
            console.error("[SERVER] Failed to restore instances:", e.message);
        }
    });
} else {
    // On Vercel, we only restore botManager if explicitly needed by a request, 
    // but Baileys won't work persistently here.
    console.log("[SERVER] Running in Serverless Environment (Vercel). API Only Mode.");
}

module.exports = app;

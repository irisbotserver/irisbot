const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_here";
const JWT_EXPIRES_IN = "7d";

const hashPassword = async (password) => {
    return await bcrypt.hash(password, 10);
};

const comparePassword = async (password, hashedPassword) => {
    return await bcrypt.compare(password, hashedPassword);
};

const generateToken = (payload) => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

const verifyToken = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
};

const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ error: "Invalid token" });
    }

    const user = await prisma.user.findUnique({
        where: { id: decoded.id }
    });

    if (!user) {
        return res.status(401).json({ error: "User not found" });
    }

    req.user = user;
    next();
};

const isAdmin = (req, res, next) => {
    console.log(`[AUTH] Checking admin role for: ${req.user.email} | Current Role: ${req.user.role}`);
    if (req.user.role?.toUpperCase() !== "ADMIN") {
        console.warn(`[AUTH] Access denied: User ${req.user.email} is not an ADMIN`);
        return res.status(403).json({ error: "Forbidden: Admin access required" });
    }
    next();
};

module.exports = {
    hashPassword,
    comparePassword,
    generateToken,
    verifyToken,
    authenticate,
    isAdmin
};

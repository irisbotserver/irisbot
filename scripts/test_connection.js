const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function test() {
    try {
        const res = await prisma.$queryRaw`SELECT 1 as test`;
        console.log("✅ Connection status: SUCCESS", res);
    } catch (err) {
        console.error("❌ Connection status: FAILED", err.message);
    } finally {
        await prisma.$disconnect();
    }
}

test();

const { PrismaClient } = require("@prisma/client");
const { generateToken } = require("./src/auth");
const prisma = new PrismaClient();

async function getAdminToken() {
    try {
        const user = await prisma.user.findFirst({ where: { role: "ADMIN" } });
        if (!user) {
            console.log("No ADMIN user found.");
            return;
        }
        const token = generateToken({ id: user.id, email: user.email, role: user.role });
        console.log("TOKEN:", token);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

getAdminToken();

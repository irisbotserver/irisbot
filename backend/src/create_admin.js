const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

async function main() {
    const usersToCreate = [
        {
            name: "davi dias",
            email: "davidiaspontes10@gmail.com",
            password: "@1Pontesdavi",
            role: "ADMIN"
        },
        {
            name: "davi",
            email: "davikko18dias@gmail.com",
            password: "@1Pontesdavi",
            role: "CLIENT"
        }
    ];

    for (const user of usersToCreate) {
        const hashedPassword = await bcrypt.hash(user.password, 10);
        try {
            const createdUser = await prisma.user.upsert({
                where: { email: user.email },
                update: { password: hashedPassword, name: user.name, role: user.role },
                create: { email: user.email, password: hashedPassword, name: user.name, role: user.role }
            });
            console.log(`✅ User ${user.role} created/updated: ${createdUser.email}`);
        } catch (err) {
            console.error(`❌ Error creating user ${user.email}:`, err.message);
        }
    }

    // Generate a test license for the admin user
    try {
        const crypto = require("crypto");
        const licenseKey = crypto.randomBytes(16).toString("hex").toUpperCase();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 365); // 1 year

        const admin = await prisma.user.findUnique({ where: { email: "davidiaspontes10@gmail.com" } });

        if (admin) {
            const license = await prisma.license.upsert({
                where: { key: "DEV-TEST-LICENSE-KEY" },
                update: { userId: admin.id, durationDays: 365, expiresAt, isActive: true },
                create: { key: "DEV-TEST-LICENSE-KEY", userId: admin.id, durationDays: 365, expiresAt, isActive: true }
            });
            console.log(`✅ Test License Created: ${license.key}`);
        }
    } catch (err) {
        console.error("❌ Error creating test license:", err.message);
    }

    await prisma.$disconnect();
}

main();

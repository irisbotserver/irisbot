const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
    const commands = [
        'ALTER TABLE "User" ENABLE ROW LEVEL SECURITY',
        'ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY',
        'ALTER TABLE "License" ENABLE ROW LEVEL SECURITY',
        'ALTER TABLE "BotLog" ENABLE ROW LEVEL SECURITY',
        'DROP POLICY IF EXISTS "Disallow all" ON "User"',
        'DROP POLICY IF EXISTS "Disallow all" ON "Tenant"',
        'DROP POLICY IF EXISTS "Disallow all" ON "License"',
        'DROP POLICY IF EXISTS "Disallow all" ON "BotLog"',
        'CREATE POLICY "Disallow all" ON "User" FOR ALL TO public USING (false)',
        'CREATE POLICY "Disallow all" ON "Tenant" FOR ALL TO public USING (false)',
        'CREATE POLICY "Disallow all" ON "License" FOR ALL TO public USING (false)',
        'CREATE POLICY "Disallow all" ON "BotLog" FOR ALL TO public USING (false)'
    ];

    for (const cmd of commands) {
        try {
            console.log(`Executing: ${cmd}`);
            await prisma.$executeRawUnsafe(cmd);
        } catch (err) {
            console.warn(`⚠️ Warning executing command: ${err.message}`);
        }
    }

    console.log("✅ Row Level Security sequence finished!");
    await prisma.$disconnect();
}

main();

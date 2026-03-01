const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
    try {
        console.log("🔒 Enabling RLS and Security Policies...");

        await prisma.$executeRawUnsafe(`
      -- Enable RLS
      ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "License" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "BotLog" ENABLE ROW LEVEL SECURITY;

      -- Drop existing policies if they exist (to avoid errors on re-run)
      DROP POLICY IF EXISTS "Disallow all" ON "User";
      DROP POLICY IF EXISTS "Disallow all" ON "Tenant";
      DROP POLICY IF EXISTS "Disallow all" ON "License";
      DROP POLICY IF EXISTS "Disallow all" ON "BotLog";

      -- Block all external access (anon/authenticated)
      -- Our Backend connects as 'postgres', which is a superuser and bypasses RLS by default.
      -- This makes the DB invisible to anyone trying to use the Supabase public API keys.
      CREATE POLICY "Disallow all" ON "User" FOR ALL TO public USING (false);
      CREATE POLICY "Disallow all" ON "Tenant" FOR ALL TO public USING (false);
      CREATE POLICY "Disallow all" ON "License" FOR ALL TO public USING (false);
      CREATE POLICY "Disallow all" ON "BotLog" FOR ALL TO public USING (false);
    `);

        console.log("✅ Row Level Security applied successfully!");
    } catch (err) {
        console.error("❌ Error applying RLS:", err.message);
    } finally {
        await prisma.$disconnect();
    }
}

main();

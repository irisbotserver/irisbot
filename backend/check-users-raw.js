const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const prisma = new PrismaClient();

async function main() {
    try {
        console.log('--- FETCHING USERS (RAW SQL) ---');
        const users = await prisma.$queryRaw`SELECT * FROM "User"`;
        console.log('--- DATABASE USERS ---');
        console.log(users);
    } catch (err) {
        console.error('ERROR:', err.message);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());

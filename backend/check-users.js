const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const prisma = new PrismaClient();
const bcrypt = require('bcryptjs');

async function main() {
    try {
        console.log('--- FETCHING USERS ---');
        const users = await prisma.user.findMany();
        console.log('--- DATABASE USERS ---');
        if (users.length === 0) console.log('No users found in DB.');
        for (const u of users) {
            const testPass = '@1Pontesdavi';
            const match = await bcrypt.compare(testPass, u.password);
            console.log(`Email: ${u.email}`);
            console.log(`Hashed Pass: ${u.password.substring(0, 10)}...`);
            console.log(`Match with '@1Pontesdavi': ${match}`);
            console.log('---------------------');
        }
    } catch (err) {
        console.error('ERROR:', err.message);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());

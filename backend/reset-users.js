const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    const password = '@1Pontesdavi';
    const hashedPassword = await bcrypt.hash(password, 10);

    // Upsert Admin User
    await prisma.user.upsert({
        where: { email: 'davidiaspontes10@gmail.com' },
        update: { password: hashedPassword, role: 'ADMIN', name: 'davi dias' },
        create: {
            email: 'davidiaspontes10@gmail.com',
            password: hashedPassword,
            name: 'davi dias',
            role: 'ADMIN',
        },
    });

    // Upsert Client User
    await prisma.user.upsert({
        where: { email: 'davikko18dias@gmail.com' },
        update: { password: hashedPassword, role: 'CLIENT', name: 'davi' },
        create: {
            email: 'davikko18dias@gmail.com',
            password: hashedPassword,
            name: 'davi',
            role: 'CLIENT',
        },
    });

    console.log('Users updated successfully with correct hashed passwords.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

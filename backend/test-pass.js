const bcrypt = require('bcryptjs');

const pass = '@1Pontesdavi';
const hash = '$2b$10$sT1nOEmnz1gAY1hrY12jG.EnU5z62jRXyb4h.bra.j9BA4pRz2lra';

async function test() {
    const match = await bcrypt.compare(pass, hash);
    console.log(`Password: ${pass}`);
    console.log(`Hash: ${hash}`);
    console.log(`Match: ${match}`);
}

test();


const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log('\nHOSPITAL CHAPEL UATH');
  console.log('Super Administrator Password Reset\n');

  const email = (await ask('Super Administrator email: '))
    .trim()
    .toLowerCase();

  const newPassword = await ask('Enter your NEW password: ');
  const confirmPassword = await ask('Confirm your NEW password: ');

  if (newPassword.length < 16 || newPassword.length > 200) {
    throw new Error('Password must contain 16–200 characters.');
  }

  if (newPassword !== confirmPassword) {
    throw new Error('Passwords do not match.');
  }

  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user || user.role !== 'SUPER_ADMIN' || user.scope !== 'SYSTEM') {
    throw new Error('The specified Super Administrator was not found.');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      active: true,
      tokenVersion: { increment: 1 }
    }
  });

  console.log('\nSUCCESS: Super Administrator password updated.');
  console.log('Your existing administrator account remains unchanged.');
}

main()
  .catch(error => {
    console.error('\nRESET FAILED:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });

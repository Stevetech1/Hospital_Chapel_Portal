
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
  console.log('First Super Administrator Setup\n');

  const email = (await ask('Administrator email: '))
    .trim()
    .toLowerCase();

  const fullName = (await ask('Administrator full name: ')).trim();

  const password = await ask(
    'Temporary setup password (minimum 16 characters): '
  );

  if (!email || !email.includes('@')) {
    throw new Error('Please provide a valid email address.');
  }

  if (fullName.length < 2) {
    throw new Error('Full name must contain at least 2 characters.');
  }

  if (password.length < 16 || password.length > 200) {
    throw new Error('Password must be between 16 and 200 characters.');
  }

  const existingAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' }
  });

  if (existingAdmin) {
    throw new Error(
      'A SUPER_ADMIN already exists. Setup stopped to prevent duplicate administrators.'
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    throw new Error(
      'This email already belongs to an account. Setup stopped.'
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.create({
    data: {
      email,
      fullName,
      passwordHash,
      role: 'SUPER_ADMIN',
      scope: 'SYSTEM',
      active: true
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      scope: true,
      active: true
    }
  });

  console.log('\nSUCCESS: Super Administrator created.');
  console.log(admin);
  console.log('\nYou can now sign in using the existing login endpoint.');
}

main()
  .catch(error => {
    console.error('\nSETUP FAILED:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });

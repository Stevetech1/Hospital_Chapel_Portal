import {PrismaClient} from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma=new PrismaClient();
async function main(){
 const email=process.env.ADMIN_EMAIL?.toLowerCase();
 const password=process.env.ADMIN_PASSWORD;
 const name=process.env.ADMIN_FULL_NAME;
 if(!email||!password||password.length<16||!name) throw new Error('Set ADMIN_EMAIL, ADMIN_PASSWORD (16+ chars) and ADMIN_FULL_NAME before running.');
 const passwordHash=await bcrypt.hash(password,12);
 await prisma.user.upsert({where:{email},update:{passwordHash,fullName:name,role:'SUPER_ADMIN',scope:'SYSTEM',active:true,tokenVersion:{increment:1}},create:{email,passwordHash,fullName:name,role:'SUPER_ADMIN',scope:'SYSTEM'}});
 console.log('Super Administrator provisioned. Remove the bootstrap environment variables after use.');
}
main().finally(()=>prisma.$disconnect());

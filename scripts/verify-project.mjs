import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const required = [
 'frontend/app/page.tsx','frontend/app/admin/page.tsx','frontend/app/academy-admin/page.tsx',
 'frontend/app/parent-portal/page.tsx','frontend/app/student-portal/page.tsx','frontend/app/teacher-portal/page.tsx',
 'frontend/app/giving/page.tsx','frontend/public/media/hospital-chapel-logo.jpeg',
 'backend/src/server.ts','backend/prisma/schema.prisma','backend/prisma/seed.ts',
 'backend/prisma/bootstrap-admin.ts','docs/API-REFERENCE.md','docs/DEPLOYMENT.md',
 'frontend/components/SiteChrome.tsx','frontend/components/ImageCarousel.tsx','frontend/components/AdminModulePage.tsx',
 'frontend/app/forgot-password/page.tsx','frontend/app/reset-password/page.tsx','frontend/app/admin/users/page.tsx','frontend/app/admin/leadership/page.tsx'
];
const errors=[];
for(const rel of required){if(!fs.existsSync(path.join(root,rel)))errors.push(`Missing required file: ${rel}`);}
for(const rel of ['frontend/package.json','backend/package.json','frontend/public/manifest.webmanifest']){
 try{JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));}catch{errors.push(`Invalid JSON: ${rel}`);}
}
const seed=fs.readFileSync(path.join(root,'backend/prisma/seed.ts'),'utf8');
const server=fs.readFileSync(path.join(root,'backend/src/server.ts'),'utf8');
const schema=fs.readFileSync(path.join(root,'backend/prisma/schema.prisma'),'utf8');
const checks=[
 ['18 ministry/committee names seeded', (seed.match(/'[^']+(?:Unit|Committee|Fellowship|Department|Voices|Council|Group)[^']*'/g)||[]).length>=18],
 ['12 family-unit seed loop', /number\s*<=\s*12/.test(seed)],
 ['2025 and 2026 themes seeded', /year:2025/.test(seed)&&/year:2026/.test(seed)],
 ['JWT secret fallback removed', !/local-development-only-change-me/.test(server)&&/JWT_SECRET\.length\s*<\s*32/.test(server)],
 ['HttpOnly session cookie configured', /httpOnly:\s*true/.test(server)],
 ['Paystack signature and verification present', /createHmac\('sha512'/.test(server)&&/transaction\/verify/.test(server)],
 ['Flutterwave transaction verification present', /transactions\/\$\{encodeURIComponent\(txId\)\}\/verify/.test(server)],
 ['Prayer request public read route absent', !/app\.get\('\/api\/public\/prayer-requests'/.test(server)],
 ['Parent-child link model present', /model GuardianStudent/.test(schema)],
 ['Teacher-class access model present', /model TeacherClass/.test(schema)],
 ['Private document scope present', /scope\s+String\s+@default\("CHURCH"\)/.test(schema)],
 ['Password reset token model present', /model PasswordResetToken/.test(schema)],
 ['Password reset endpoints present', /api\/auth\/forgot-password/.test(server)&&/api\/auth\/reset-password/.test(server)],
 ['Password reset revokes active sessions', /tokenVersion: \{ increment: 1 \}/.test(server)],
 ['Super Admin provisioning is restricted', /Only an existing Super Administrator can appoint another Super Administrator/.test(server)],
 ['Dedicated page routes are present', /admin\/users/.test(fs.readFileSync(path.join(root,'frontend/app/admin/page.tsx'),'utf8'))&&fs.existsSync(path.join(root,'frontend/app/family-units/page.tsx'))],
 ['Social icon footer is configurable', /SOCIAL_LINKS/.test(fs.readFileSync(path.join(root,'frontend/components/SiteChrome.tsx'),'utf8'))],
 ['Image carousel is present', /ImageCarousel/.test(fs.readFileSync(path.join(root,'frontend/app/page.tsx'),'utf8'))]
];
for(const [name,ok] of checks)if(!ok)errors.push(`Check failed: ${name}`);
if(fs.existsSync(path.join(root,'.env')))errors.push('Do not package a local .env file');
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`Static project checks passed: ${required.length} required files, 3 JSON files, ${checks.length} implementation checks.`);
console.log('This does not replace dependency installation, TypeScript type-checking, Prisma validation, database integration tests or production security review.');

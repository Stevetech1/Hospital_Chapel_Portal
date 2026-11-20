import { ApprovalStatus, PaymentStatus, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { z } from 'zod';

// Load a local backend/.env or project-root .env for direct VS Code development.
// Existing process/container environment variables always take precedence.
for (const envFile of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../.env')]) {
  if (!fs.existsSync(envFile)) continue;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const app = express();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || '';
if (JWT_SECRET.length < 32 || /replace|change-this|example/i.test(JWT_SECRET)) throw new Error('Set JWT_SECRET to a private random value of at least 32 characters before starting the API.');
const PORT = Number(process.env.PORT || 4000);
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'private-uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(helmet());
app.use(cors({ origin: (process.env.FRONTEND_ORIGIN || 'http://localhost:3000').split(','), credentials: true }));
app.use('/api/webhooks/paystack', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 150, standardHeaders: true, legacyHeaders: false }));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, message: { error: 'Too many login attempts. Try again later.' } });

const ROLES = {
  churchAdmin: ['SUPER_ADMIN', 'CHURCH_ADMIN'],
  churchEditors: ['SUPER_ADMIN', 'CHURCH_ADMIN', 'PASTOR', 'SECRETARY'],
  contentEditors: ['SUPER_ADMIN', 'CHURCH_ADMIN', 'PASTOR', 'SECRETARY', 'MEDIA_ADMIN'],
  finance: ['SUPER_ADMIN', 'FINANCE_ADMIN'],
  academyAdmin: ['SUPER_ADMIN', 'ACADEMY_SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'ACADEMIC_COORDINATOR', 'ADMISSIONS_OFFICER'],
  academyStaff: ['SUPER_ADMIN', 'ACADEMY_SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'ACADEMIC_COORDINATOR', 'TEACHER', 'ADMISSIONS_OFFICER']
};
type AuthUser = { sub: string; ver?: number; role?: string; scope?: string; email?: string };
function authenticate(req: any, res: any, next: any) {
  const header = String(req.headers.authorization || '');
  const cookieToken = String(req.headers.cookie || '').split(';').map((v: string) => v.trim()).find((v: string) => v.startsWith('hcuath_session='))?.slice('hcuath_session='.length);
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || cookieToken;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { req.authToken = jwt.verify(token, JWT_SECRET, { issuer: 'hospital-chapel-uath', audience: 'hospital-chapel-platform' }); next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired session' }); }
}
async function loadActiveUser(req: any, res: any, next: any) {
  try {
    const claims = req.authToken as AuthUser;
    const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, email: true, fullName: true, role: true, scope: true, familyUnitNumber: true, active: true, tokenVersion: true } });
    if (!user || !user.active) return res.status(401).json({ error: 'Account is disabled or unavailable' });
    if ((claims.ver ?? 0) !== user.tokenVersion) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    const { tokenVersion: _tokenVersion, ...safeUser } = user;
    req.user = safeUser; next();
  } catch { res.status(500).json({ error: 'Unable to validate session' }); }
}
function allow(roles: string[], scope?: 'CHURCH' | 'ACADEMY' | 'SYSTEM') {
  return (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    if (scope && req.user.scope !== scope && req.user.scope !== 'SYSTEM') return res.status(403).json({ error: 'This account cannot access this institutional area' });
    next();
  };
}

function canManageDocument(user: any, document: any) {
  if (user.scope === 'SYSTEM') return true;
  if (user.scope !== document.scope) return false;
  if (document.uploaderId === user.id) return true;
  if (user.scope === 'CHURCH') {
    return ['SUPER_ADMIN', 'CHURCH_ADMIN', 'PASTOR', 'SECRETARY', 'FINANCE_ADMIN'].includes(user.role);
  }
  if (user.scope === 'ACADEMY') {
    return ['SUPER_ADMIN', 'ACADEMY_SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'ACADEMIC_COORDINATOR'].includes(user.role);
  }
  return false;
}
const secured = [authenticate, loadActiveUser];
async function audit(userId: string, action: string, entity: string, entityId?: string, ipAddress?: string) {
  await prisma.auditLog.create({ data: { actorId: userId, action, entity, entityId, ipAddress } });
}
function safeError(err: any, res: express.Response) {
  if (err?.code === 'P2002') return res.status(409).json({ error: 'A record with this unique value already exists' });
  if (err?.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
  console.error(err); return res.status(500).json({ error: 'The operation could not be completed' });
}

// Authentication: public registration is intentionally not provided.
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const parsed = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(200) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email or password' });
  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user || !user.active || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ sub: user.id, ver: user.tokenVersion }, JWT_SECRET, { expiresIn: '30m', issuer: 'hospital-chapel-uath', audience: 'hospital-chapel-platform' });
    res.cookie('hcuath_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 30 * 60 * 1000 });
    await audit(user.id, 'LOGIN', 'User', user.id, req.ip);
    res.json({ user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, scope: user.scope }, expiresIn: 1800 });
  } catch (e) { safeError(e, res); }
});
app.get('/api/auth/me', ...secured, (req: any, res) => res.json(req.user));
app.post('/api/auth/logout', ...secured, async (req: any, res) => { await audit(req.user.id, 'LOGOUT', 'User', req.user.id, req.ip); res.clearCookie('hcuath_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' }); res.json({ ok: true }); });


// Password recovery: one-time, hashed, expiring tokens. Email delivery is enabled by RESEND_API_KEY + EMAIL_FROM.
const passwordResetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
app.post('/api/auth/forgot-password', passwordResetLimiter, async (req, res) => {
  const parsed = z.object({ email: z.string().email().max(254) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address.' });
  const generic = { message: 'If an active account exists for that email address, password-reset instructions will be sent.' };
  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user || !user.active) return res.json(generic);
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    const siteUrl = (process.env.PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
    if (!apiKey || !from) {
      console.warn('Password reset requested, but RESEND_API_KEY or EMAIL_FROM is not configured.');
      return res.json(generic);
    }
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    const resetUrl = `${siteUrl}/reset-password?token=${rawToken}`;
    const safeName = user.fullName.replace(/[&<>\"']/g, (char: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[char] || ''));
    let delivered = false;
    try {
      const mail = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [user.email], subject: 'Reset your Hospital Chapel account password', html: `<p>Hello ${safeName},</p><p>We received a request to reset your Hospital Chapel account password.</p><p><a href="${resetUrl}">Reset password</a></p><p>This one-time link expires in 30 minutes. If you did not request this, ignore this email.</p>` }) });
      delivered = mail.ok;
      if (!mail.ok) console.error('Password reset email provider returned an error:', mail.status);
    } catch (mailError) { console.error('Password reset email delivery failed.'); }
    if (!delivered) await prisma.passwordResetToken.deleteMany({ where: { tokenHash } });
    res.json(generic);
  } catch (e) { safeError(e, res); }
});

app.post('/api/auth/reset-password', passwordResetLimiter, async (req, res) => {
  const parsed = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/i), password: z.string().min(16).max(200) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Use a valid reset link and a password of at least 16 characters.' });
  try {
    const tokenHash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
    const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date() || !reset.user.active) return res.status(400).json({ error: 'This password-reset link is invalid or has expired. Request a new link.' });
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await prisma.$transaction(async (tx: any) => {
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new Error('RESET_TOKEN_ALREADY_USED');
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash, tokenVersion: { increment: 1 } } });
      await tx.passwordResetToken.deleteMany({ where: { userId: reset.userId, id: { not: reset.id } } });
      await tx.auditLog.create({ data: { actorId: reset.userId, action: 'PASSWORD_RESET', entity: 'User', entityId: reset.userId, ipAddress: req.ip } });
    });
    res.clearCookie('hcuath_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
    res.json({ message: 'Password updated successfully. Please sign in with your new password.' });
  } catch (e: any) { if (e?.message === 'RESET_TOKEN_ALREADY_USED') return res.status(400).json({ error: 'This password-reset link has already been used. Request a new link.' }); safeError(e, res); }
});

// Strict allow-listed schemas prevent mass assignment and arbitrary model writes.
const optionalText = (max = 5000) => z.string().max(max).nullable().optional();
const jsonValue = z.unknown().optional();
const schemas: Record<string, z.ZodTypeAny> = {
  announcements: z.object({
    title: z.string().trim().min(2).max(180),
    body: z.string().trim().min(5).max(12000),
    category: optionalText(100),
    visibility: z.enum(['PUBLIC', 'PRIVATE', 'RESTRICTED']).optional(),
    status: z.nativeEnum(ApprovalStatus).optional(),
    publishAt: z.coerce.date().nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional()
  }).strict(),
  leadership: z.object({ fullName: z.string().min(2).max(180), position: z.string().min(2).max(180), profileType: z.string().min(2).max(80), biography: optionalText(12000), photographUrl: optionalText(1000), serviceStart: optionalText(40), serviceEnd: optionalText(40), appointmentDate: z.coerce.date().nullable().optional(), departureDate: z.coerce.date().nullable().optional(), achievements: optionalText(12000), contributions: optionalText(12000), annualThemes: optionalText(4000), status: z.nativeEnum(ApprovalStatus).optional() }).strict(),
  departments: z.object({ name: z.string().min(2).max(180), category: z.string().min(2).max(100), description: optionalText(), functions: optionalText(), termsOfReference: optionalText(12000), leader: optionalText(180), leaderUserId: z.string().nullable().optional(), secretary: optionalText(180), members: jsonValue, establishedAt: z.coerce.date().nullable().optional(), meetingSchedule: optionalText(500), activities: optionalText(5000), annualReports: optionalText(12000), photographs: jsonValue, documents: jsonValue, status: z.nativeEnum(ApprovalStatus).optional() }).strict(),
  familyUnits: z.object({ number: z.number().int().min(1).max(12), name: z.string().min(2).max(100), leader: optionalText(180), secretary: optionalText(180), functions: optionalText(), meetingSchedule: optionalText(500), announcements: optionalText(5000), annualReports: optionalText(12000), photographs: jsonValue, resources: jsonValue, status: z.nativeEnum(ApprovalStatus).optional() }).strict(),
  monthlyThemes: z.object({ month: z.number().int().min(1).max(12), subtitle: optionalText(1000), bibleReference: optionalText(500), teachingMaterialUrl: optionalText(1000), annualThemeId: z.string().min(1), status: z.nativeEnum(ApprovalStatus).optional() }).strict(),
  themes: z.object({ year: z.number().int().min(1990).max(2200), title: z.string().min(2).max(180), bibleReference: optionalText(300), exposition: optionalText(12000), graphicUrl: optionalText(1000), status: z.nativeEnum(ApprovalStatus).optional() }).strict(),
  events: z.object({ title: z.string().min(2).max(180), description: optionalText(5000), startsAt: z.coerce.date(), endsAt: z.coerce.date().nullable().optional(), venue: optionalText(300), status: z.nativeEnum(ApprovalStatus).optional() }).strict(),
  sermons: z.object({ title: z.string().min(2).max(180), preacher: optionalText(180), bibleReferences: optionalText(500), topic: optionalText(300), sermonDate: z.coerce.date().nullable().optional(), videoUrl: optionalText(1000), audioUrl: optionalText(1000), transcript: optionalText(20000), status: z.nativeEnum(ApprovalStatus).optional() }).strict(),
  projects: z.object({ title: z.string().min(2).max(180), description: optionalText(5000), objectives: optionalText(5000), status: z.string().max(80).optional(), startDate: z.coerce.date().nullable().optional(), completionDate: z.coerce.date().nullable().optional(), achievements: optionalText(10000), approvedFinancialSummary: optionalText(5000), documents: jsonValue }).strict(),
  outreach: z.object({ name: z.string().min(2).max(180), community: optionalText(180), location: optionalText(300), outreachDate: z.coerce.date().nullable().optional(), services: optionalText(5000), personnel: jsonValue, beneficiaryCount: z.number().int().nonnegative().nullable().optional(), aggregateStatistics: jsonValue, reportUrl: optionalText(1000), media: jsonValue }).strict(),
  documents: z.object({ title: z.string().min(2).max(180), category: z.string().min(2).max(100), description: optionalText(3000), fileUrl: z.string().min(1).max(1000), mimeType: optionalText(150), approvalStatus: z.nativeEnum(ApprovalStatus).optional(), visibility: z.enum(['PUBLIC', 'PRIVATE', 'RESTRICTED']).optional() }).strict(),
  contentPages: z.object({ slug: z.string().regex(/^[a-z0-9-]+$/).max(180), title: z.string().min(2).max(180), body: optionalText(30000), metadata: jsonValue, visibility: z.enum(['PUBLIC', 'PRIVATE', 'RESTRICTED']).optional(), status: z.nativeEnum(ApprovalStatus).optional() }).strict(),
  members: z.object({ memberNumber: z.string().max(80).nullable().optional(), fullName: z.string().min(2).max(180), email: z.string().email().max(254).nullable().optional(), phone: optionalText(60), address: optionalText(500), dateJoined: z.coerce.date().nullable().optional(), familyUnitId: z.string().nullable().optional(), userId: z.string().nullable().optional(), status: z.enum(['PENDING','ACTIVE','INACTIVE','ARCHIVED']).optional() }).strict(),
  academicClasses: z.object({ name: z.string().min(2).max(100), level: optionalText(100), academicYear: optionalText(30) }).strict(),
  academyStudents: z.object({ admissionNumber: z.string().min(1).max(80), firstName: z.string().min(1).max(100), lastName: z.string().min(1).max(100), classLevel: optionalText(100), dateOfBirth: z.coerce.date().nullable().optional(), guardianUserId: z.string().nullable().optional(), userId: z.string().nullable().optional(), classId: z.string().nullable().optional(), status: z.enum(['ACTIVE','INACTIVE','WITHDRAWN','GRADUATED']).optional() }).strict(),
  academyStaff: z.object({ fullName: z.string().min(2).max(180), role: z.string().min(2).max(100), biography: optionalText(5000), qualifications: optionalText(3000), photographUrl: optionalText(1000) }).strict(),
  academyApplications: z.object({ applicantName: z.string().min(2).max(180), guardianName: z.string().min(2).max(180), guardianEmail: z.string().email(), requestedLevel: optionalText(100), documents: jsonValue, status: z.enum(['RECEIVED','UNDER_REVIEW','ACCEPTED','DECLINED']).optional() }).strict(),
  academyResources: z.object({ title: z.string().min(2).max(180), category: z.string().min(2).max(100), description: optionalText(3000), fileUrl: optionalText(1000), visibility: z.enum(['PUBLIC','PRIVATE','RESTRICTED']).optional() }).strict(),
  academicAssignments: z.object({ title: z.string().min(2).max(180), instructions: optionalText(5000), dueAt: z.coerce.date().nullable().optional(), classId: z.string().nullable().optional(), resourceUrl: optionalText(1000), status: z.nativeEnum(ApprovalStatus).optional() }).strict(),
  studentAssessments: z.object({ studentId: z.string(), subject: z.string().min(2).max(120), assessmentName: z.string().min(2).max(180), score: z.number().min(0).nullable().optional(), maxScore: z.number().positive().nullable().optional(), term: optionalText(60), remarks: optionalText(2000) }).strict(),
  attendanceRecords: z.object({ studentId: z.string(), attendanceDate: z.coerce.date(), status: z.enum(['PRESENT','ABSENT','LATE','EXCUSED']), note: optionalText(1000) }).strict()
};
const modelMap: Record<string, any> = {
  announcements: { model: prisma.announcement, scope: 'CHURCH', roles: ROLES.contentEditors },
  leadership: { model: prisma.leaderProfile, scope: 'CHURCH', roles: ROLES.churchEditors },
  departments: { model: prisma.department, scope: 'CHURCH', roles: [...ROLES.churchEditors, 'DEPARTMENT_LEADER'] },
  familyUnits: { model: prisma.familyUnit, scope: 'CHURCH', roles: [...ROLES.churchEditors, 'FAMILY_UNIT_LEADER'] },
  themes: { model: prisma.annualTheme, scope: 'CHURCH', roles: ROLES.churchEditors },
  monthlyThemes: { model: prisma.monthlyTheme, scope: 'CHURCH', roles: ROLES.churchEditors },
  events: { model: prisma.event, scope: 'CHURCH', roles: ROLES.contentEditors },
  sermons: { model: prisma.sermon, scope: 'CHURCH', roles: ROLES.contentEditors },
  projects: { model: prisma.churchProject, scope: 'CHURCH', roles: ROLES.churchEditors },
  outreach: { model: prisma.outreach, scope: 'CHURCH', roles: ROLES.churchEditors },
  documents: { model: prisma.document, scope: 'CHURCH', roles: ROLES.contentEditors },
  contentPages: { model: prisma.contentPage, scope: 'CHURCH', roles: ROLES.contentEditors },
  members: { model: prisma.member, scope: 'CHURCH', roles: [...ROLES.churchEditors, 'FAMILY_UNIT_LEADER'] },
  academicClasses: { model: prisma.academicClass, scope: 'ACADEMY', roles: ROLES.academyAdmin },
  academyStudents: { model: prisma.academyStudent, scope: 'ACADEMY', roles: ROLES.academyAdmin },
  academyStaff: { model: prisma.academyStaff, scope: 'ACADEMY', roles: ROLES.academyAdmin },
  academyApplications: { model: prisma.academyApplication, scope: 'ACADEMY', roles: ROLES.academyAdmin },
  academyResources: { model: prisma.academyResource, scope: 'ACADEMY', roles: ROLES.academyStaff },
  academyDocuments: { model: prisma.document, scope: 'ACADEMY', roles: ROLES.academyStaff },
  academicAssignments: { model: prisma.academicAssignment, scope: 'ACADEMY', roles: ['SUPER_ADMIN','ACADEMY_SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL','ACADEMIC_COORDINATOR','TEACHER'] },
  studentAssessments: { model: prisma.studentAssessment, scope: 'ACADEMY', roles: ['SUPER_ADMIN','ACADEMY_SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL','ACADEMIC_COORDINATOR','TEACHER'] },
  attendanceRecords: { model: prisma.attendanceRecord, scope: 'ACADEMY', roles: ['SUPER_ADMIN','ACADEMY_SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL','ACADEMIC_COORDINATOR','TEACHER'] },
  donations: { model: prisma.donation, scope: 'CHURCH', roles: ROLES.finance }
};
function parseResourceBody(resource: string, body: any, partial = false) {
  const resolved = resource === 'academyDocuments' ? 'documents' : resource;
  const resolvedSchema = schemas[resolved];
  if (!resolvedSchema) return { success: false as const, error: 'Unknown resource' };
  return (partial ? (resolvedSchema as any).partial() : resolvedSchema).safeParse(body);
}
app.get('/api/admin/overview', ...secured, allow([...ROLES.contentEditors, ...ROLES.academyAdmin, ...ROLES.finance], undefined), async (req: any, res) => {
  try {
    const isChurch = req.user.scope === 'CHURCH' || req.user.scope === 'SYSTEM';
    const isAcademy = req.user.scope === 'ACADEMY' || req.user.scope === 'SYSTEM';
    const counts: any = {};
    if (isChurch) Object.assign(counts, {
      leaders: await prisma.leaderProfile.count(), departments: await prisma.department.count(), familyUnits: await prisma.familyUnit.count(), members: await prisma.member.count(), pendingPrayerRequests: await prisma.prayerRequest.count({ where: { status: 'NEW' } }), pendingTestimonies: await prisma.testimony.count({ where: { status: ApprovalStatus.SUBMITTED } }), pendingDocuments: await prisma.document.count({ where: { approvalStatus: ApprovalStatus.SUBMITTED } })
    });
    if (isAcademy) Object.assign(counts, { students: await prisma.academyStudent.count(), applications: await prisma.academyApplication.count(), staff: await prisma.academyStaff.count(), classes: await prisma.academicClass.count(), assignments: await prisma.academicAssignment.count() });
    if (req.user.role === 'FINANCE_ADMIN' || req.user.scope === 'SYSTEM') Object.assign(counts, { donationsPending: await prisma.donation.count({ where: { status: PaymentStatus.PENDING } }), donationsVerified: await prisma.donation.count({ where: { status: PaymentStatus.SUCCESS } }) });
    res.json({ counts, role: req.user.role, scope: req.user.scope });
  } catch (e) { safeError(e, res); }
});
app.post('/api/admin/users', ...secured, allow(ROLES.churchAdmin, undefined), async (req: any, res) => {
  const parsed = z.object({ email: z.string().email(), fullName: z.string().min(2).max(180), password: z.string().min(16).max(200), role: z.enum(['SUPER_ADMIN','CHURCH_ADMIN','PASTOR','SECRETARY','MEDIA_ADMIN','FINANCE_ADMIN','FAMILY_UNIT_LEADER','DEPARTMENT_LEADER','MEMBER','ACADEMY_SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL','ACADEMIC_COORDINATOR','TEACHER','ADMISSIONS_OFFICER','PARENT','STUDENT']), scope: z.enum(['SYSTEM','CHURCH','ACADEMY']), familyUnitNumber: z.number().int().min(1).max(12).optional() }).strict().refine(v => v.role !== 'FAMILY_UNIT_LEADER' || !!v.familyUnitNumber, { message: 'Family unit number is required for a Family Unit Leader' }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid user record; password must be at least 16 characters' });
  if (parsed.data.role === 'SUPER_ADMIN' && (parsed.data.scope !== 'SYSTEM' || req.user.role !== 'SUPER_ADMIN' || req.user.scope !== 'SYSTEM')) return res.status(403).json({ error: 'Only an existing Super Administrator can appoint another Super Administrator' });
  if (parsed.data.scope === 'SYSTEM' && parsed.data.role !== 'SUPER_ADMIN') return res.status(400).json({ error: 'SYSTEM scope is reserved for Super Administrators' });
  if (req.user.scope !== 'SYSTEM' && parsed.data.scope !== 'CHURCH') return res.status(403).json({ error: 'Church administrators cannot create Academy or system accounts' });
  if (req.user.scope !== 'SYSTEM' && ['CHURCH_ADMIN'].includes(parsed.data.role)) return res.status(403).json({ error: 'Only a Super Administrator can appoint another administrator' });
  if (parsed.data.scope === 'CHURCH' && !['CHURCH_ADMIN','PASTOR','SECRETARY','MEDIA_ADMIN','FINANCE_ADMIN','FAMILY_UNIT_LEADER','DEPARTMENT_LEADER','MEMBER'].includes(parsed.data.role)) return res.status(400).json({ error: 'Role and scope do not match' });
  if (parsed.data.scope === 'ACADEMY' && !['ACADEMY_SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL','ACADEMIC_COORDINATOR','TEACHER','ADMISSIONS_OFFICER','PARENT','STUDENT'].includes(parsed.data.role)) return res.status(400).json({ error: 'Role and scope do not match' });
  try { const passwordHash = await bcrypt.hash(parsed.data.password, 12); const user = await prisma.user.create({ data: { email: parsed.data.email.toLowerCase(), fullName: parsed.data.fullName, passwordHash, role: parsed.data.role, scope: parsed.data.scope, familyUnitNumber: parsed.data.familyUnitNumber } }); await audit(req.user.id, 'CREATE_USER', 'User', user.id, req.ip); res.status(201).json({ id: user.id, email: user.email, fullName: user.fullName, role: user.role, scope: user.scope }); } catch (e) { safeError(e, res); }
});

app.get('/api/admin/users', ...secured, allow(ROLES.churchAdmin, undefined), async (req: any, res) => {
  const where = req.user.scope === 'SYSTEM' ? {} : { scope: 'CHURCH' };
  res.json(await prisma.user.findMany({ where, take: 300, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, fullName: true, role: true, scope: true, familyUnitNumber: true, active: true, createdAt: true } }));
});

app.patch('/api/admin/users/:id', ...secured, allow(ROLES.churchAdmin, undefined), async (req: any, res) => {
  const parsed = z.object({ fullName: z.string().min(2).max(180).optional(), active: z.boolean().optional(), password: z.string().min(16).max(200).optional(), role: z.enum(['SUPER_ADMIN','CHURCH_ADMIN','PASTOR','SECRETARY','MEDIA_ADMIN','FINANCE_ADMIN','FAMILY_UNIT_LEADER','DEPARTMENT_LEADER','MEMBER']).optional(), familyUnitNumber: z.number().int().min(1).max(12).nullable().optional() }).strict().refine(v => v.role !== 'FAMILY_UNIT_LEADER' || !!v.familyUnitNumber, { message: 'Family unit number is required for a Family Unit Leader' }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid account update' });
  try { const target = await prisma.user.findUnique({ where: { id: req.params.id } }); if (!target || (target.scope !== 'CHURCH' && !(req.user.scope === 'SYSTEM' && target.scope === 'SYSTEM'))) return res.status(404).json({ error: 'Account not found in an accessible institutional scope' }); if (target.scope === 'SYSTEM' && req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Only a Super Administrator can manage system accounts' }); if (req.user.scope !== 'SYSTEM' && ['CHURCH_ADMIN','SUPER_ADMIN'].includes(target.role)) return res.status(403).json({ error: 'Only a Super Administrator can manage administrator accounts' }); if (req.user.scope !== 'SYSTEM' && ['CHURCH_ADMIN','SUPER_ADMIN'].includes(parsed.data.role || '')) return res.status(403).json({ error: 'Only a Super Administrator can appoint administrator accounts' }); if (target.scope === 'SYSTEM' && parsed.data.role && parsed.data.role !== 'SUPER_ADMIN') return res.status(400).json({ error: 'SYSTEM accounts must retain the SUPER_ADMIN role' }); if (target.scope !== 'SYSTEM' && parsed.data.role === 'SUPER_ADMIN') return res.status(400).json({ error: 'SUPER_ADMIN accounts must use SYSTEM scope' }); if (target.role === 'SUPER_ADMIN' && (parsed.data.active === false || (parsed.data.role && parsed.data.role !== 'SUPER_ADMIN'))) { const activeSuperAdmins = await prisma.user.count({ where: { role: 'SUPER_ADMIN', scope: 'SYSTEM', active: true } }); if (activeSuperAdmins <= 1) return res.status(409).json({ error: 'The last active Super Administrator cannot be suspended or demoted' }); } const data: any = { ...parsed.data }; if (data.password) { data.passwordHash = await bcrypt.hash(data.password, 12); data.tokenVersion = { increment: 1 }; delete data.password; } else if (typeof data.active === 'boolean') { data.tokenVersion = { increment: 1 }; } const updated = await prisma.user.update({ where: { id: target.id }, data }); await audit(req.user.id, 'UPDATE_USER', 'User', updated.id, req.ip); res.json({ id: updated.id, email: updated.email, fullName: updated.fullName, role: updated.role, scope: updated.scope, active: updated.active, familyUnitNumber: updated.familyUnitNumber }); } catch (e) { safeError(e, res); }
});
app.patch('/api/admin/academy/users/:id', ...secured, allow(ROLES.academyAdmin, 'ACADEMY'), async (req: any, res) => {
  const parsed = z.object({ fullName: z.string().min(2).max(180).optional(), active: z.boolean().optional(), password: z.string().min(16).max(200).optional(), role: z.enum(['ACADEMY_SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL','ACADEMIC_COORDINATOR','TEACHER','ADMISSIONS_OFFICER','PARENT','STUDENT']).optional() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid Academy account update' });
  try { const target = await prisma.user.findUnique({ where: { id: req.params.id } }); if (!target || target.scope !== 'ACADEMY') return res.status(404).json({ error: 'Academy account not found' }); if (['ACADEMY_SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL','ACADEMIC_COORDINATOR'].includes(target.role) && !['SUPER_ADMIN','ACADEMY_SUPER_ADMIN'].includes(req.user.role)) return res.status(403).json({ error: 'Only an Academy Super Administrator can manage this account' }); if (['SCHOOL_ADMIN','PRINCIPAL','ACADEMIC_COORDINATOR'].includes(parsed.data.role || '') && !['SUPER_ADMIN','ACADEMY_SUPER_ADMIN'].includes(req.user.role)) return res.status(403).json({ error: 'Only an Academy Super Administrator can appoint this role' }); const data: any = { ...parsed.data }; if (data.password) { data.passwordHash = await bcrypt.hash(data.password, 12); data.tokenVersion = { increment: 1 }; delete data.password; } else if (typeof data.active === 'boolean') { data.tokenVersion = { increment: 1 }; } const updated = await prisma.user.update({ where: { id: target.id }, data }); await audit(req.user.id, 'UPDATE_ACADEMY_USER', 'User', updated.id, req.ip); res.json({ id: updated.id, email: updated.email, fullName: updated.fullName, role: updated.role, scope: updated.scope, active: updated.active }); } catch (e) { safeError(e, res); }
});
app.get('/api/admin/audit-logs', ...secured, allow([...ROLES.contentEditors, ...ROLES.academyAdmin, ...ROLES.finance], undefined), async (req: any, res) => {
  const where = req.user.scope === 'SYSTEM' ? {} : { actor: { is: { scope: req.user.scope } } };
  res.json(await prisma.auditLog.findMany({ where, take: 300, orderBy: { createdAt: 'desc' }, include: { actor: { select: { fullName: true, email: true, role: true, scope: true } } } }));
});

app.get('/api/admin/:resource', ...secured, async (req: any, res) => {
  const cfg = modelMap[req.params.resource];
  if (!cfg) return res.status(404).json({ error: 'Unknown resource' });
  if (!cfg.roles.includes(req.user.role) || (req.user.scope !== cfg.scope && req.user.scope !== 'SYSTEM')) return res.status(403).json({ error: 'Insufficient permissions' });
  try {
    let rows;
    if (req.params.resource === 'donations') rows = await cfg.model.findMany({ take: 300, orderBy: { createdAt: 'desc' }, select: { reference: true, category: true, amountKobo: true, currency: true, anonymous: true, donorName: true, provider: true, status: true, verifiedAt: true, createdAt: true } });
    else if (req.params.resource === 'familyUnits' && req.user.role === 'FAMILY_UNIT_LEADER') rows = await cfg.model.findMany({ where: { number: req.user.familyUnitNumber }, take: 1 });
    else if (req.params.resource === 'departments' && req.user.role === 'DEPARTMENT_LEADER') rows = await cfg.model.findMany({ where: { leaderUserId: req.user.id }, take: 20 });
    else if (req.params.resource === 'members' && req.user.role === 'FAMILY_UNIT_LEADER') rows = await cfg.model.findMany({ where: { familyUnit: { number: req.user.familyUnitNumber } }, take: 250, orderBy: { id: 'desc' } });
    else if (req.user.role === 'TEACHER' && ['studentAssessments','attendanceRecords'].includes(req.params.resource)) { const assigned = await prisma.teacherClass.findMany({ where: { teacherUserId: req.user.id }, select: { classId: true } }); const classIds = assigned.map((x:any)=>x.classId); rows = await cfg.model.findMany({ where: { student: { classId: { in: classIds } } }, take: 250, orderBy: { id: 'desc' } }); }
    else if (req.user.role === 'TEACHER' && req.params.resource === 'academicAssignments') { const assigned = await prisma.teacherClass.findMany({ where: { teacherUserId: req.user.id }, select: { classId: true } }); rows = await cfg.model.findMany({ where: { classId: { in: assigned.map((x:any)=>x.classId) } }, take: 250, orderBy: { id: 'desc' } }); }
    else if (['documents','academyDocuments'].includes(req.params.resource)) {
      const isManager = req.user.scope === 'SYSTEM' ||
        (req.user.scope === 'CHURCH' && ['SUPER_ADMIN','CHURCH_ADMIN','PASTOR','SECRETARY','FINANCE_ADMIN'].includes(req.user.role)) ||
        (req.user.scope === 'ACADEMY' && ['SUPER_ADMIN','ACADEMY_SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL','ACADEMIC_COORDINATOR'].includes(req.user.role));
      rows = await cfg.model.findMany({
        where: { scope: cfg.scope, ...(isManager ? {} : { uploaderId: req.user.id }) },
        take: 250,
        orderBy: { id: 'desc' }
      });
    }
    else rows = await cfg.model.findMany({ take: 250, orderBy: { id: 'desc' } });
    res.json(rows);
  } catch (e) { safeError(e, res); }
});
app.post('/api/admin/:resource', ...secured, async (req: any, res) => {
  const cfg = modelMap[req.params.resource];
  if (!cfg) return res.status(404).json({ error: 'Unknown resource' });
  if (!cfg.roles.includes(req.user.role) || (req.user.scope !== cfg.scope && req.user.scope !== 'SYSTEM')) return res.status(403).json({ error: 'Insufficient permissions' });
  if (req.params.resource === 'donations') return res.status(405).json({ error: 'Donations are created only through verified payment initialization' });
  if (req.params.resource === 'familyUnits' && req.user.role === 'FAMILY_UNIT_LEADER') return res.status(403).json({ error: 'Family Unit Leaders cannot create additional units' });
  if (req.user.role === 'DEPARTMENT_LEADER') return res.status(403).json({ error: 'Department Leaders may manage only their assigned department record' });
  const parsed = parseResourceBody(req.params.resource, req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid record', details: (parsed as any).error || (parsed as any).issues });
  try {
    if (req.user.role === 'TEACHER' && ['studentAssessments','attendanceRecords'].includes(req.params.resource)) { const student = await prisma.academyStudent.findUnique({ where: { id: (parsed.data as any).studentId } }); const assigned = student?.classId ? await prisma.teacherClass.findUnique({ where: { teacherUserId_classId: { teacherUserId: req.user.id, classId: student.classId } } }) : null; if (!assigned) return res.status(403).json({ error: 'You can only manage learners in classes assigned to you' }); }
    if (req.user.role === 'TEACHER' && req.params.resource === 'academicAssignments') { const classId = (parsed.data as any).classId; const assigned = classId ? await prisma.teacherClass.findUnique({ where: { teacherUserId_classId: { teacherUserId: req.user.id, classId } } }) : null; if (!assigned) return res.status(403).json({ error: 'You can only create assignments for classes assigned to you' }); }
    if (req.params.resource === 'members' && (parsed.data as any).userId) { const memberUser = await prisma.user.findFirst({ where: { id: (parsed.data as any).userId, scope: 'CHURCH', role: 'MEMBER', active: true } }); if (!memberUser) return res.status(400).json({ error: 'member userId must reference an active Church Member account' }); }
    if (req.params.resource === 'departments' && (parsed.data as any).leaderUserId) { const leaderUser = await prisma.user.findFirst({ where: { id: (parsed.data as any).leaderUserId, scope: 'CHURCH', role: 'DEPARTMENT_LEADER', active: true } }); if (!leaderUser) return res.status(400).json({ error: 'leaderUserId must reference an active Church Department Leader account' }); }
    if (req.params.resource === 'members' && req.user.role === 'FAMILY_UNIT_LEADER') { const unit = await prisma.familyUnit.findUnique({ where: { id: (parsed.data as any).familyUnitId || '' } }); if (!unit || unit.number !== req.user.familyUnitNumber) return res.status(403).json({ error: 'Cannot allocate members outside your assigned family unit' }); }
    if (req.params.resource === 'academyStudents' && (parsed.data as any).userId) { const studentUser = await prisma.user.findFirst({ where: { id: (parsed.data as any).userId, scope: 'ACADEMY', role: 'STUDENT', active: true } }); if (!studentUser) return res.status(400).json({ error: 'Student userId must reference an active Academy Student account' }); }
    const item = await cfg.model.create({ data: req.params.resource === 'documents' || req.params.resource === 'academyDocuments'
      ? { ...parsed.data, scope: cfg.scope, uploaderId: req.user.id }
      : req.params.resource === 'announcements'
        ? { ...parsed.data, createdById: req.user.id }
        : parsed.data });
    await audit(req.user.id, 'CREATE', req.params.resource, item.id, req.ip);
    res.status(201).json(item);
  } catch (e) { safeError(e, res); }
});
app.patch('/api/admin/:resource/:id', ...secured, async (req: any, res) => {
  const cfg = modelMap[req.params.resource];
  if (!cfg) return res.status(404).json({ error: 'Unknown resource' });
  if (!cfg.roles.includes(req.user.role) || (req.user.scope !== cfg.scope && req.user.scope !== 'SYSTEM')) return res.status(403).json({ error: 'Insufficient permissions' });
  if (req.params.resource === 'donations') return res.status(405).json({ error: 'Donation records are immutable through this endpoint' });
  const parsed = parseResourceBody(req.params.resource, req.body, true);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid update', details: (parsed as any).error || (parsed as any).issues });
  try {
    const before = await cfg.model.findUnique({ where: { id: req.params.id } });
    if (req.user.role === 'TEACHER' && ['studentAssessments','attendanceRecords'].includes(req.params.resource) && before) { const studentId = (parsed.data as any).studentId || (before as any).studentId; const student = await prisma.academyStudent.findUnique({ where: { id: studentId } }); const assigned = student?.classId ? await prisma.teacherClass.findUnique({ where: { teacherUserId_classId: { teacherUserId: req.user.id, classId: student.classId } } }) : null; if (!assigned) return res.status(403).json({ error: 'You can only update learners in classes assigned to you' }); }
    if (req.user.role === 'TEACHER' && req.params.resource === 'academicAssignments' && before) { const classId = (parsed.data as any).classId || (before as any).classId; const assigned = classId ? await prisma.teacherClass.findUnique({ where: { teacherUserId_classId: { teacherUserId: req.user.id, classId } } }) : null; if (!assigned) return res.status(403).json({ error: 'You can only update assignments for classes assigned to you' }); }
    if (req.params.resource === 'members' && req.user.role === 'FAMILY_UNIT_LEADER') { if (!(before as any)?.familyUnitId) return res.status(403).json({ error: 'This member is not allocated to your family unit' }); const assigned = await prisma.familyUnit.findUnique({ where: { id: (before as any).familyUnitId } }); if (assigned?.number !== req.user.familyUnitNumber) return res.status(403).json({ error: 'Cannot edit a member outside your assigned family unit' }); const targetUnitId = (parsed.data as any).familyUnitId; if (targetUnitId !== undefined) { const targetUnit = targetUnitId ? await prisma.familyUnit.findUnique({ where: { id: targetUnitId } }) : null; if (!targetUnit || targetUnit.number !== req.user.familyUnitNumber) return res.status(403).json({ error: 'Cannot transfer or unassign a member outside your assigned family unit' }); } }
    if (!before) return res.status(404).json({ error: 'Record not found' });
    if (['documents','academyDocuments'].includes(req.params.resource) && !canManageDocument(req.user, before)) {
      return res.status(403).json({ error: 'You can only manage documents you uploaded unless you are an institutional administrator' });
    }
    if (req.params.resource === 'members' && (parsed.data as any).userId) { const memberUser = await prisma.user.findFirst({ where: { id: (parsed.data as any).userId, scope: 'CHURCH', role: 'MEMBER', active: true } }); if (!memberUser) return res.status(400).json({ error: 'member userId must reference an active Church Member account' }); }
    if (req.params.resource === 'departments' && (parsed.data as any).leaderUserId) { const leaderUser = await prisma.user.findFirst({ where: { id: (parsed.data as any).leaderUserId, scope: 'CHURCH', role: 'DEPARTMENT_LEADER', active: true } }); if (!leaderUser) return res.status(400).json({ error: 'leaderUserId must reference an active Church Department Leader account' }); }
    if (req.params.resource === 'academyStudents' && (parsed.data as any).userId) { const studentUser = await prisma.user.findFirst({ where: { id: (parsed.data as any).userId, scope: 'ACADEMY', role: 'STUDENT', active: true } }); if (!studentUser) return res.status(400).json({ error: 'Student userId must reference an active Academy Student account' }); }
    if (req.params.resource === 'familyUnits' && req.user.role === 'FAMILY_UNIT_LEADER' && before.number !== Number(req.user.familyUnitNumber)) return res.status(403).json({ error: 'Cannot edit another family unit' });
    if (req.params.resource === 'familyUnits' && req.user.role === 'FAMILY_UNIT_LEADER') { delete (parsed.data as any).number; }
    if (req.params.resource === 'departments' && req.user.role === 'DEPARTMENT_LEADER') { delete (parsed.data as any).leaderUserId; }
    if (req.params.resource === 'departments' && req.user.role === 'DEPARTMENT_LEADER' && before.leaderUserId !== req.user.id) return res.status(403).json({ error: 'Cannot edit a department not assigned to you' });
    if (['leadership','departments','familyUnits','themes','contentPages'].includes(req.params.resource)) {
      const last = await prisma.contentRevision.findFirst({ where: { entity: req.params.resource, entityId: req.params.id }, orderBy: { version: 'desc' } });
      await prisma.contentRevision.create({ data: { entity: req.params.resource, entityId: req.params.id, version: (last?.version || 0) + 1, snapshot: JSON.parse(JSON.stringify(before)), changedBy: req.user.id } });
    }
    const item = await cfg.model.update({ where: { id: req.params.id }, data: parsed.data });
    await audit(req.user.id, 'UPDATE', req.params.resource, item.id, req.ip);
    res.json(item);
  } catch (e) { safeError(e, res); }
});
app.get('/api/admin/:resource/:id/revisions', ...secured, allow(ROLES.churchEditors, 'CHURCH'), async (req: any, res) => {
  if (!['leadership','departments','familyUnits','themes','contentPages'].includes(req.params.resource)) return res.status(404).json({ error: 'Version history is not enabled for this resource' });
  res.json(await prisma.contentRevision.findMany({ where: { entity: req.params.resource, entityId: req.params.id }, orderBy: { version: 'desc' }, take: 50 }));
});
app.post('/api/admin/:resource/:id/approval', ...secured, async (req: any, res) => {
  const cfg = modelMap[req.params.resource];
  const churchApprovers = ['events','sermons','documents','contentPages','announcements'].includes(req.params.resource) ? ROLES.contentEditors : ROLES.churchEditors;
  const academyApprovers = ROLES.academyAdmin;
  if (!cfg || !['leadership','departments','familyUnits','themes','monthlyThemes','events','sermons','documents','academyDocuments','contentPages','announcements','academyResources','academicAssignments'].includes(req.params.resource)) return res.status(404).json({ error: 'Approval is not supported for this resource' });
  const roles = cfg.scope === 'ACADEMY' ? academyApprovers : churchApprovers;
  if (!roles.includes(req.user.role) || (req.user.scope !== cfg.scope && req.user.scope !== 'SYSTEM')) return res.status(403).json({ error: 'Approval permission required' });
  const parsed = z.object({ status: z.nativeEnum(ApprovalStatus) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid approval status' });
  try {
    const model = cfg.model;
    const item = await model.update({ where: { id: req.params.id }, data: ['documents','academyDocuments'].includes(req.params.resource) ? { approvalStatus: parsed.data.status } : { status: parsed.data.status } });
    await audit(req.user.id, `SET_${parsed.data.status}`, req.params.resource, item.id, req.ip);
    res.json(item);
  } catch (e) { safeError(e, res); }
});

// Private ministry submissions. No public read endpoint exists for these records.
app.get('/api/admin/private/prayer-requests', ...secured, allow(ROLES.churchEditors, 'CHURCH'), async (_req, res) => res.json(await prisma.prayerRequest.findMany({ take: 200, orderBy: { createdAt: 'desc' } })));
app.patch('/api/admin/private/prayer-requests/:id', ...secured, allow(ROLES.churchEditors, 'CHURCH'), async (req: any, res) => {
  const parsed = z.object({ status: z.enum(['NEW','ASSIGNED','PRAYED_FOR','CLOSED']), assignedTo: z.string().max(180).nullable().optional() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid prayer request update' });
  try { const row = await prisma.prayerRequest.update({ where: { id: req.params.id }, data: parsed.data }); await audit(req.user.id, 'UPDATE_PRIVATE_PRAYER_REQUEST', 'PrayerRequest', row.id, req.ip); res.json({ id: row.id, status: row.status }); } catch (e) { safeError(e, res); }
});
app.get('/api/admin/private/testimonies', ...secured, allow(ROLES.churchEditors, 'CHURCH'), async (_req, res) => res.json(await prisma.testimony.findMany({ take: 200, orderBy: { createdAt: 'desc' } })));
app.post('/api/admin/private/testimonies/:id/approval', ...secured, allow(ROLES.churchEditors, 'CHURCH'), async (req: any, res) => { const parsed = z.object({ status: z.nativeEnum(ApprovalStatus) }).strict().safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Invalid approval status' }); try { const item = await prisma.testimony.update({ where: { id: req.params.id }, data: { status: parsed.data.status } }); await audit(req.user.id, `SET_${parsed.data.status}`, 'Testimony', item.id, req.ip); res.json({ id: item.id, status: item.status }); } catch (e) { safeError(e, res); } });
app.post('/api/admin/academy/users', ...secured, allow(ROLES.academyAdmin, 'ACADEMY'), async (req: any, res) => {
  const parsed = z.object({ email: z.string().email(), fullName: z.string().min(2).max(180), password: z.string().min(16).max(200), role: z.enum(['SCHOOL_ADMIN','PRINCIPAL','ACADEMIC_COORDINATOR','TEACHER','ADMISSIONS_OFFICER','PARENT','STUDENT']) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid Academy account; password must be at least 16 characters' });
  if (['SCHOOL_ADMIN','PRINCIPAL','ACADEMIC_COORDINATOR'].includes(parsed.data.role) && !['SUPER_ADMIN','ACADEMY_SUPER_ADMIN'].includes(req.user.role)) return res.status(403).json({ error: 'Only an Academy Super Administrator can appoint this role' });
  try { const passwordHash = await bcrypt.hash(parsed.data.password, 12); const user = await prisma.user.create({ data: { email: parsed.data.email.toLowerCase(), fullName: parsed.data.fullName, passwordHash, role: parsed.data.role, scope: 'ACADEMY' } }); await audit(req.user.id, 'CREATE_ACADEMY_USER', 'User', user.id, req.ip); res.status(201).json({ id: user.id, email: user.email, fullName: user.fullName, role: user.role, scope: user.scope }); } catch (e) { safeError(e, res); }
});
app.get('/api/admin/academy/users', ...secured, allow(ROLES.academyAdmin, 'ACADEMY'), async (_req, res) => {
  res.json(await prisma.user.findMany({ where: { scope: 'ACADEMY' }, take: 300, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, fullName: true, role: true, scope: true, active: true, createdAt: true } }));
});
app.get('/api/member/me', ...secured, allow(['MEMBER'], 'CHURCH'), async (req: any, res) => { const member = await prisma.member.findUnique({ where: { userId: req.user.id }, include: { familyUnit: { select: { number: true, name: true } } } }); if (!member) return res.status(404).json({ error: 'Member profile is not linked to this account' }); res.json({ fullName: member.fullName, memberNumber: member.memberNumber, familyUnit: member.familyUnit, status: member.status }); });

// Academy portals: guardians can only see children explicitly linked to their own account.
app.get('/api/parent/students', ...secured, allow(['PARENT'], 'ACADEMY'), async (req: any, res) => {
  const guardian = await prisma.parentGuardian.findUnique({ where: { userId: req.user.id }, include: { students: { include: { student: { include: { class: true } } } } } });
  if (!guardian) return res.status(404).json({ error: 'No guardian profile is linked to this account' });
  res.json(guardian.students.map((link: any) => ({ id: link.student.id, admissionNumber: link.student.admissionNumber, firstName: link.student.firstName, lastName: link.student.lastName, class: link.student.class?.name || link.student.classLevel, relationship: link.relationship })));
});
app.get('/api/student/me', ...secured, allow(['STUDENT'], 'ACADEMY'), async (req: any, res) => {
  const student = await prisma.academyStudent.findUnique({ where: { userId: req.user.id }, include: { class: true } });
  if (!student) return res.status(404).json({ error: 'Student profile is not linked to this account' });
  res.json({ admissionNumber: student.admissionNumber, firstName: student.firstName, lastName: student.lastName, class: student.class?.name || student.classLevel });
});
app.get('/api/admin/academy/guardians', ...secured, allow(ROLES.academyAdmin, 'ACADEMY'), async (_req, res) => { res.json(await prisma.parentGuardian.findMany({ include: { user: { select: { id: true, fullName: true, email: true, active: true } }, students: { include: { student: { select: { id: true, admissionNumber: true, firstName: true, lastName: true } } } } }, take: 250, orderBy: { createdAt: 'desc' } })); });
app.post('/api/admin/academy/guardians', ...secured, allow(ROLES.academyAdmin, 'ACADEMY'), async (req: any, res) => {
  const parsed = z.object({ userId: z.string(), phone: z.string().max(60).optional() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid guardian profile' });
  try { const user = await prisma.user.findFirst({ where: { id: parsed.data.userId, scope: 'ACADEMY', role: 'PARENT', active: true } }); if (!user) return res.status(404).json({ error: 'An active Academy parent account is required' }); const guardian = await prisma.parentGuardian.create({ data: { user: { connect: { id: user.id } }, phone: parsed.data.phone } }); await audit(req.user.id, 'CREATE_GUARDIAN_PROFILE', 'ParentGuardian', guardian.id, req.ip); res.status(201).json({ id: guardian.id, userId: guardian.userId }); } catch (e) { safeError(e, res); }
});
app.get('/api/parent/students/:studentId/records', ...secured, allow(['PARENT'], 'ACADEMY'), async (req: any, res) => {
  const guardian = await prisma.parentGuardian.findUnique({ where: { userId: req.user.id }, include: { students: { where: { studentId: req.params.studentId } } } });
  if (!guardian || guardian.students.length === 0) return res.status(404).json({ error: 'This learner is not linked to your guardian account' });
  const [assessments, attendance] = await Promise.all([prisma.studentAssessment.findMany({ where: { studentId: req.params.studentId }, orderBy: { recordedAt: 'desc' } }), prisma.attendanceRecord.findMany({ where: { studentId: req.params.studentId }, orderBy: { attendanceDate: 'desc' }, take: 120 })]);
  res.json({ assessments, attendance });
});
app.get('/api/student/assessments', ...secured, allow(['STUDENT'], 'ACADEMY'), async (req: any, res) => { const student = await prisma.academyStudent.findUnique({ where: { userId: req.user.id } }); if (!student) return res.status(404).json({ error: 'Student profile not linked' }); res.json(await prisma.studentAssessment.findMany({ where: { studentId: student.id }, orderBy: { recordedAt: 'desc' } })); });
app.get('/api/student/assignments', ...secured, allow(['STUDENT'], 'ACADEMY'), async (req: any, res) => { const student = await prisma.academyStudent.findUnique({ where: { userId: req.user.id } }); if (!student?.classId) return res.json([]); res.json(await prisma.academicAssignment.findMany({ where: { classId: student.classId, status: ApprovalStatus.APPROVED }, include: { submissions: { where: { studentId: student.id }, select: { responseText: true, submittedAt: true, feedback: true, score: true } } }, orderBy: { dueAt: 'asc' } })); });
app.post('/api/student/assignments/:id/submit', ...secured, allow(['STUDENT'], 'ACADEMY'), async (req: any, res) => { const parsed = z.object({ responseText: z.string().min(1).max(12000) }).strict().safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Enter your assignment response' }); try { const student = await prisma.academyStudent.findUnique({ where: { userId: req.user.id } }); const assignment = await prisma.academicAssignment.findUnique({ where: { id: req.params.id } }); if (!student || !assignment || assignment.status !== ApprovalStatus.APPROVED || !student.classId || assignment.classId !== student.classId) return res.status(404).json({ error: 'Approved assignment not found for your class' }); const submission = await prisma.studentSubmission.upsert({ where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } }, update: { responseText: parsed.data.responseText, submittedAt: new Date() }, create: { assignmentId: assignment.id, studentId: student.id, responseText: parsed.data.responseText } }); await audit(req.user.id, 'SUBMIT_ASSIGNMENT', 'StudentSubmission', submission.id, req.ip); res.status(201).json({ id: submission.id, submittedAt: submission.submittedAt }); } catch (e) { safeError(e, res); } });
app.get('/api/admin/academy/assignments/:id/submissions', ...secured, allow(['SUPER_ADMIN','ACADEMY_SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL','ACADEMIC_COORDINATOR','TEACHER'], 'ACADEMY'), async (req: any, res) => { const assignment = await prisma.academicAssignment.findUnique({ where: { id: req.params.id } }); if (!assignment) return res.status(404).json({ error: 'Assignment not found' }); if (req.user.role === 'TEACHER' && (!assignment.classId || !await prisma.teacherClass.findUnique({ where: { teacherUserId_classId: { teacherUserId: req.user.id, classId: assignment.classId } } }))) return res.status(403).json({ error: 'You are not assigned to this class' }); res.json(await prisma.studentSubmission.findMany({ where: { assignmentId: assignment.id }, include: { student: { select: { admissionNumber: true, firstName: true, lastName: true } } }, orderBy: { submittedAt: 'desc' } })); });
app.post('/api/admin/academy/submissions/:id/grade', ...secured, allow(['SUPER_ADMIN','ACADEMY_SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL','ACADEMIC_COORDINATOR','TEACHER'], 'ACADEMY'), async (req: any, res) => { const parsed = z.object({ score: z.number().min(0).nullable().optional(), feedback: z.string().max(5000).nullable().optional() }).strict().safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Invalid grading details' }); try { const submission = await prisma.studentSubmission.findUnique({ where: { id: req.params.id }, include: { assignment: true } }); if (!submission) return res.status(404).json({ error: 'Submission not found' }); if (req.user.role === 'TEACHER' && (!submission.assignment.classId || !await prisma.teacherClass.findUnique({ where: { teacherUserId_classId: { teacherUserId: req.user.id, classId: submission.assignment.classId } } }))) return res.status(403).json({ error: 'You are not assigned to this class' }); const updated = await prisma.studentSubmission.update({ where: { id: submission.id }, data: parsed.data }); await audit(req.user.id, 'GRADE_ASSIGNMENT', 'StudentSubmission', updated.id, req.ip); res.json({ id: updated.id, score: updated.score, feedback: updated.feedback }); } catch (e) { safeError(e, res); } });
app.post('/api/admin/academy/classes/:classId/teachers', ...secured, allow(ROLES.academyAdmin, 'ACADEMY'), async (req: any, res) => {
  const parsed = z.object({ teacherUserId: z.string() }).strict().safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Invalid teacher assignment' });
  try { const teacher = await prisma.user.findFirst({ where: { id: parsed.data.teacherUserId, scope: 'ACADEMY', role: 'TEACHER', active: true } }); if (!teacher) return res.status(404).json({ error: 'An active Academy teacher account is required' }); const classExists = await prisma.academicClass.findUnique({ where: { id: req.params.classId } }); if (!classExists) return res.status(404).json({ error: 'Academic class not found' }); const link = await prisma.teacherClass.create({ data: { teacherUserId: teacher.id, classId: req.params.classId } }); await audit(req.user.id, 'ASSIGN_TEACHER_TO_CLASS', 'TeacherClass', link.id, req.ip); res.status(201).json({ id: link.id }); } catch (e) { safeError(e, res); }
});
app.get('/api/teacher/classes', ...secured, allow(['TEACHER'], 'ACADEMY'), async (req: any, res) => { const assigned = await prisma.teacherClass.findMany({ where: { teacherUserId: req.user.id }, include: { class: { include: { students: { select: { id: true, admissionNumber: true, firstName: true, lastName: true, status: true } } } } } }); res.json(assigned.map((x:any)=>({id:x.class.id,name:x.class.name,level:x.class.level,academicYear:x.class.academicYear,students:x.class.students}))); });
app.post('/api/admin/academy/classes', ...secured, allow(ROLES.academyAdmin, 'ACADEMY'), async (req: any, res) => {
  const parsed = z.object({ name: z.string().min(2).max(100), level: z.string().max(100).optional(), academicYear: z.string().max(30).optional() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid class record' });
  try { const item = await prisma.academicClass.create({ data: { name: parsed.data.name!, level: parsed.data.level, academicYear: parsed.data.academicYear } }); await audit(req.user.id, 'CREATE', 'AcademicClass', item.id, req.ip); res.status(201).json(item); } catch (e) { safeError(e, res); }
});
app.post('/api/admin/academy/guardians/:guardianId/link-student', ...secured, allow(ROLES.academyAdmin, 'ACADEMY'), async (req: any, res) => {
  const parsed = z.object({ studentId: z.string(), relationship: z.string().max(80).optional() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid guardian/student link' });
  try { const guardian = await prisma.parentGuardian.findUnique({ where: { id: req.params.guardianId } }); const student = await prisma.academyStudent.findUnique({ where: { id: parsed.data.studentId } }); if (!guardian || !student) return res.status(404).json({ error: 'Guardian or student record not found' }); const link = await prisma.guardianStudent.create({ data: { guardianId: req.params.guardianId, studentId: parsed.data.studentId, relationship: parsed.data.relationship } }); await audit(req.user.id, 'LINK_GUARDIAN_STUDENT', 'GuardianStudent', link.id, req.ip); res.status(201).json({ id: link.id }); } catch (e) { safeError(e, res); }
});

// Private document upload. Files are not exposed through a public static directory.
const allowedMime = new Set(['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp','audio/mpeg','audio/mp4','video/mp4','video/webm']);
const storage = multer.diskStorage({ destination: (_req, _file, cb) => cb(null, UPLOAD_DIR), filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase().slice(0,12)}`) });
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => allowedMime.has(file.mimetype) ? cb(null, true) : cb(new Error('Unsupported file type')) });
function hasValidFileSignature(filePath: string, mimeType: string, originalName: string) { const fd = fs.openSync(filePath, 'r'); const b = Buffer.alloc(16); try { fs.readSync(fd, b, 0, 16, 0); } finally { fs.closeSync(fd); } const ext = path.extname(originalName).toLowerCase(); if (mimeType === 'application/pdf') return b.subarray(0,5).toString() === '%PDF-'; if (mimeType === 'image/jpeg') return b[0]===0xff && b[1]===0xd8 && b[2]===0xff; if (mimeType === 'image/png') return b.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])); if (mimeType === 'image/webp') return b.subarray(0,4).toString()==='RIFF' && b.subarray(8,12).toString()==='WEBP'; if (mimeType === 'video/mp4' || mimeType === 'audio/mp4') return b.subarray(4,8).toString()==='ftyp'; if (mimeType === 'video/webm') return b.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])); if (mimeType === 'audio/mpeg') return b.subarray(0,3).toString()==='ID3' || (b[0]===0xff && (b[1]&0xe0)===0xe0); if (mimeType.includes('wordprocessingml') || mimeType.includes('spreadsheetml')) return b[0]===0x50 && b[1]===0x4b && ['.docx','.xlsx'].includes(ext); return false; }
app.post('/api/admin/documents/upload', ...secured, allow(ROLES.contentEditors, 'CHURCH'), upload.single('file'), async (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: 'Select a supported file' });
  if (!hasValidFileSignature(req.file.path, req.file.mimetype, req.file.originalname)) { fs.unlinkSync(req.file.path); return res.status(415).json({ error: 'The uploaded file content does not match its declared type' }); }
  const parsed = z.object({ title: z.string().min(2).max(180), category: z.string().min(2).max(100), description: z.string().max(3000).optional(), visibility: z.enum(['PUBLIC','PRIVATE','RESTRICTED']).optional() }).safeParse(req.body);
  if (!parsed.success) { fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'Document metadata is invalid' }); }
  try { const doc = await prisma.document.create({ data: {  title: parsed.data.title!, category: parsed.data.category!, description: parsed.data.description, visibility: parsed.data.visibility, fileUrl: req.file.filename, mimeType: req.file.mimetype, uploaderId: req.user.id, approvalStatus: ApprovalStatus.DRAFT } }); await audit(req.user.id, 'UPLOAD_DOCUMENT', 'Document', doc.id, req.ip); res.status(201).json({ id: doc.id, title: doc.title, approvalStatus: doc.approvalStatus }); } catch (e) { fs.unlinkSync(req.file.path); safeError(e, res); }
});
app.post('/api/admin/academy/documents/upload', ...secured, allow(ROLES.academyStaff, 'ACADEMY'), upload.single('file'), async (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: 'Select a supported file' });
  if (!hasValidFileSignature(req.file.path, req.file.mimetype, req.file.originalname)) { fs.unlinkSync(req.file.path); return res.status(415).json({ error: 'The uploaded file content does not match its declared type' }); }
  const parsed = z.object({ title: z.string().min(2).max(180), category: z.string().min(2).max(100), description: z.string().max(3000).optional(), visibility: z.enum(['PUBLIC','PRIVATE','RESTRICTED']).optional() }).safeParse(req.body);
  if (!parsed.success) { fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'Document metadata is invalid' }); }
  try { const doc = await prisma.document.create({ data: { title: parsed.data.title!, category: parsed.data.category!, description: parsed.data.description, visibility: parsed.data.visibility, scope: 'ACADEMY', fileUrl: req.file.filename, mimeType: req.file.mimetype, uploaderId: req.user.id, approvalStatus: ApprovalStatus.DRAFT } }); await audit(req.user.id, 'UPLOAD_ACADEMY_DOCUMENT', 'Document', doc.id, req.ip); res.status(201).json({ id: doc.id, title: doc.title, approvalStatus: doc.approvalStatus }); } catch (e) { fs.unlinkSync(req.file.path); safeError(e, res); }
});
app.get('/api/admin/documents/:id/download', ...secured, async (req: any, res) => {
  try { const doc = await prisma.document.findUnique({ where: { id: req.params.id } }); if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (req.user.scope !== 'SYSTEM' && req.user.scope !== doc.scope) return res.status(403).json({ error: 'Document belongs to another institutional area' });
    const allowed = (doc.visibility === 'PUBLIC' && doc.approvalStatus === ApprovalStatus.APPROVED) || canManageDocument(req.user, doc);
    if (!allowed) return res.status(403).json({ error: 'Document access denied' });
    const file = path.join(UPLOAD_DIR, path.basename(doc.fileUrl)); if (!fs.existsSync(file)) return res.status(404).json({ error: 'Stored file is unavailable' });
    await audit(req.user.id, 'DOWNLOAD_DOCUMENT', 'Document', doc.id, req.ip); res.download(file, path.basename(file));
  } catch (e) { safeError(e, res); }
});

// Public, approved content only.
app.get('/api/public/leadership', async (_req, res) => res.json(await prisma.leaderProfile.findMany({ where: { status: ApprovalStatus.APPROVED } })));
app.get('/api/public/departments', async (_req, res) => res.json(await prisma.department.findMany({ where: { status: ApprovalStatus.APPROVED } })));
app.get('/api/public/family-units', async (_req, res) => res.json(await prisma.familyUnit.findMany({ where: { status: ApprovalStatus.APPROVED }, orderBy: { number: 'asc' } })));
app.get('/api/public/themes', async (_req, res) => res.json(await prisma.annualTheme.findMany({ where: { status: ApprovalStatus.APPROVED }, include: { months: { where: { status: ApprovalStatus.APPROVED } } }, orderBy: { year: 'desc' } })));
app.get('/api/public/documents', async (_req, res) => res.json(await prisma.document.findMany({ where: { scope: 'CHURCH', visibility: 'PUBLIC', approvalStatus: ApprovalStatus.APPROVED }, select: { id: true, title: true, category: true, description: true, mimeType: true, createdAt: true }, take: 100, orderBy: { createdAt: 'desc' } })));
app.get('/api/public/documents/:id/download', async (req, res) => { const doc = await prisma.document.findFirst({ where: { id: req.params.id, scope: 'CHURCH', visibility: 'PUBLIC', approvalStatus: ApprovalStatus.APPROVED } }); if (!doc) return res.status(404).json({ error: 'Document not found' }); const file = path.join(UPLOAD_DIR, path.basename(doc.fileUrl)); if (!fs.existsSync(file)) return res.status(404).json({ error: 'File unavailable' }); res.download(file, path.basename(file)); });
app.get('/api/public/announcements', async (_req, res) => {
  const now = new Date();
  const rows = await prisma.announcement.findMany({
    where: {
      status: ApprovalStatus.APPROVED,
      visibility: 'PUBLIC',
      AND: [
        { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  res.json(rows);
});
app.get('/api/public/events', async (_req, res) => res.json(await prisma.event.findMany({ where: { status: ApprovalStatus.APPROVED, startsAt: { gte: new Date() } }, orderBy: { startsAt: 'asc' } })));
app.get('/api/public/sermons', async (_req, res) => res.json(await prisma.sermon.findMany({ where: { status: ApprovalStatus.APPROVED }, orderBy: { sermonDate: 'desc' } })));
app.get('/api/public/content/:slug', async (req, res) => { const item = await prisma.contentPage.findFirst({ where: { slug: req.params.slug, status: ApprovalStatus.APPROVED, visibility: 'PUBLIC' } }); if (!item) return res.status(404).json({ error: 'Page not found' }); res.json(item); });
const prayerSchema = z.object({ name: z.string().trim().max(120).optional(), contact: z.string().trim().max(120).optional(), request: z.string().trim().min(5).max(5000) }).strict();
app.post('/api/public/prayer-requests', async (req, res) => {
  const parsed = prayerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const item = await prisma.prayerRequest.create({
    data: {
      name: parsed.data.name ?? null,
      contact: parsed.data.contact ?? null,
      request: parsed.data.request!
    }
  });
  res.status(201).json({ id: item.id, status: 'received' });
});
const testimonySchema = z.object({ name: z.string().trim().max(120).optional(), title: z.string().trim().min(2).max(180), story: z.string().trim().min(10).max(8000), consentToPublish: z.boolean().optional() }).strict();
app.post('/api/public/testimonies', async (req, res) => {
  const parsed = testimonySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid submission' });
  const item = await prisma.testimony.create({
    data: {
      name: parsed.data.name ?? null,
      title: parsed.data.title!,
      story: parsed.data.story!,
      consentToPublish: parsed.data.consentToPublish ?? false,
      status: ApprovalStatus.SUBMITTED
    }
  });
  res.status(201).json({ id: item.id, status: 'submitted_for_review' });
});
const contactSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), subject: z.string().trim().max(180).optional(), message: z.string().trim().min(5).max(5000) }).strict();
app.post('/api/public/contact', async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid submission' });
  const item = await prisma.contactMessage.create({
    data: {
      name: parsed.data.name!,
      email: parsed.data.email!.toLowerCase(),
      subject: parsed.data.subject ?? null,
      message: parsed.data.message!
    }
  });
  res.status(201).json({ id: item.id, status: 'received' });
});

app.get('/api/public/donation-qr', async (req, res) => {
  const parsed = z.object({ category: z.enum(['FREE_WILL_OFFERING','TITHES','THANKSGIVING','MISSIONS','WELFARE','BUILDING_FUND','SPECIAL_PROJECTS','OTHER']).optional() }).strict().safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid donation category' });
  const base = process.env.PUBLIC_SITE_URL || 'http://localhost:3000';
  const target = new URL('/giving', base); if (parsed.data.category) target.searchParams.set('category', parsed.data.category);
  try { const dataUrl = await QRCode.toDataURL(target.toString(), { errorCorrectionLevel: 'H', margin: 2, width: 480 }); res.json({ targetUrl: target.toString(), dataUrl }); } catch (e) { safeError(e, res); }
});

// Donation initialization: create PENDING only. Success is set only after provider verification.
const donationSchema = z.object({ amount: z.number().positive().max(100000000), category: z.enum(['FREE_WILL_OFFERING','TITHES','THANKSGIVING','MISSIONS','WELFARE','BUILDING_FUND','SPECIAL_PROJECTS','OTHER']), provider: z.enum(['PAYSTACK','FLUTTERWAVE']), email: z.string().email(), donorName: z.string().max(180).optional(), anonymous: z.boolean().optional() }).strict();
app.post('/api/public/donations/initialize', async (req, res) => {
  const parsed = donationSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Invalid donation details' });
  if (parsed.data.provider === 'PAYSTACK' && !process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({ error: 'Paystack is not configured yet' });
  if (parsed.data.provider === 'FLUTTERWAVE' && !process.env.FLUTTERWAVE_SECRET_KEY) return res.status(503).json({ error: 'Flutterwave is not configured yet' });
  const reference = `HCUATH-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  try {
    const donation = await prisma.donation.create({ data: { reference, category: parsed.data.category, amountKobo: Math.round(parsed.data.amount * 100), currency: 'NGN', anonymous: parsed.data.anonymous || false, donorName: parsed.data.anonymous ? null : parsed.data.donorName, provider: parsed.data.provider, status: PaymentStatus.PENDING } });
    if (parsed.data.provider === 'PAYSTACK') {
      const key = process.env.PAYSTACK_SECRET_KEY!;
      const response = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: parsed.data.email, amount: donation.amountKobo, reference, callback_url: process.env.PAYSTACK_CALLBACK_URL }) });
      const data: any = await response.json(); if (!response.ok || !data.status) return res.status(502).json({ error: 'Payment provider could not initialize the transaction', reference });
      return res.status(201).json({ reference, authorizationUrl: data.data.authorization_url, accessCode: data.data.access_code, status: 'PENDING' });
    }
    const key = process.env.FLUTTERWAVE_SECRET_KEY; if (!key) return res.status(503).json({ error: 'Flutterwave is not configured yet', reference });
    const response = await fetch('https://api.flutterwave.com/v3/payments', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tx_ref: reference, amount: parsed.data.amount, currency: 'NGN', redirect_url: process.env.FLUTTERWAVE_CALLBACK_URL, customer: { email: parsed.data.email, name: parsed.data.anonymous ? 'Anonymous' : (parsed.data.donorName || 'Donor') }, meta: { category: parsed.data.category } }) });
    const data: any = await response.json(); if (!response.ok || data.status !== 'success') return res.status(502).json({ error: 'Payment provider could not initialize the transaction', reference });
    res.status(201).json({ reference, authorizationUrl: data.data.link, status: 'PENDING' });
  } catch (e) { safeError(e, res); }
});
app.post('/api/webhooks/paystack', async (req: any, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY; if (!secret) return res.status(503).send('Not configured');
  const signature = String(req.headers['x-paystack-signature'] || '');
  const digest = crypto.createHmac('sha512', secret).update(req.body).digest('hex');
  if (!signature || Buffer.byteLength(signature) !== Buffer.byteLength(digest) || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) return res.status(401).send('Invalid signature');
  try {
    const event = JSON.parse(req.body.toString()); if (event.event !== 'charge.success') return res.sendStatus(200);
    const reference = String(event.data?.reference || '');
    const verify = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
    const verified: any = await verify.json(); if (!verify.ok || !verified.status || verified.data.status !== 'success' || verified.data.reference !== reference) return res.status(400).send('Payment verification failed');
    const donation = await prisma.donation.findUnique({ where: { reference } }); if (!donation || donation.provider !== 'PAYSTACK' || donation.amountKobo !== Number(verified.data.amount) || verified.data.currency !== 'NGN') return res.status(400).send('Donation mismatch');
    await prisma.$transaction([prisma.paymentEvent.upsert({ where: { providerEventId: `paystack:${event.data.id}` }, update: {}, create: { provider: 'PAYSTACK', providerEventId: `paystack:${event.data.id}`, reference, eventType: event.event, payload: event } }), prisma.donation.update({ where: { reference }, data: { status: PaymentStatus.SUCCESS, providerReference: String(event.data.id), verifiedAt: new Date() } }), prisma.auditLog.create({ data: { action: 'PAYMENT_VERIFIED', entity: 'Donation', entityId: donation.id } })]);
    res.sendStatus(200);
  } catch { res.status(400).send('Invalid webhook payload'); }
});
app.post('/api/webhooks/flutterwave', async (req: any, res) => {
  const secret = process.env.FLUTTERWAVE_SECRET_KEY; const hookSecret = process.env.FLUTTERWAVE_WEBHOOK_HASH;
  if (!secret || !hookSecret || req.headers['verif-hash'] !== hookSecret) return res.status(401).send('Invalid webhook signature');
  try {
    const txId = String(req.body?.data?.id || ''); if (!txId) return res.sendStatus(200);
    const verify = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(txId)}/verify`, { headers: { Authorization: `Bearer ${secret}` } });
    const verified: any = await verify.json(); const d = verified.data;
    if (!verify.ok || verified.status !== 'success' || d?.status !== 'successful') return res.status(400).send('Payment verification failed');
    const reference = String(d.tx_ref || ''); const donation = await prisma.donation.findUnique({ where: { reference } });
    if (!donation || donation.provider !== 'FLUTTERWAVE' || Math.round(Number(d.amount) * 100) !== donation.amountKobo || d.currency !== 'NGN') return res.status(400).send('Donation mismatch');
    await prisma.$transaction([prisma.paymentEvent.upsert({ where: { providerEventId: `flutterwave:${txId}` }, update: {}, create: { provider: 'FLUTTERWAVE', providerEventId: `flutterwave:${txId}`, reference, eventType: 'charge.completed', payload: req.body } }), prisma.donation.update({ where: { reference }, data: { status: PaymentStatus.SUCCESS, providerReference: txId, verifiedAt: new Date() } }), prisma.auditLog.create({ data: { action: 'PAYMENT_VERIFIED', entity: 'Donation', entityId: donation.id } })]);
    res.sendStatus(200);
  } catch { res.status(400).send('Invalid webhook payload'); }
});
app.get('/api/public/donations/:reference/status', async (req, res) => {
  const reference = z.string().regex(/^HCUATH-[A-Z0-9-]{8,80}$/).safeParse(req.params.reference);
  if (!reference.success) return res.status(400).json({ error: 'Invalid payment reference' });
  const donation = await prisma.donation.findUnique({ where: { reference: reference.data }, select: { reference: true, category: true, amountKobo: true, currency: true, status: true, verifiedAt: true } });
  if (!donation) return res.status(404).json({ error: 'Payment reference not found' });
  res.json({ ...donation, amount: donation.amountKobo / 100 });
});
app.get('/api/admin/reports/church', ...secured, allow(ROLES.churchEditors, 'CHURCH'), async (_req, res) => {
  const [units, departments, members, prayer, testimonies, projects] = await Promise.all([prisma.familyUnit.findMany({ select: { id: true, number: true, name: true, _count: { select: { members: true } } }, orderBy: { number: 'asc' } }), prisma.department.count(), prisma.member.count(), prisma.prayerRequest.count(), prisma.testimony.count(), prisma.churchProject.count()]);
  res.json({ familyUnits: units.map((u:any)=>({number:u.number,name:u.name,members:u._count.members})), departmentCount: departments, memberCount: members, prayerRequestCount: prayer, testimonyCount: testimonies, projectCount: projects });
});
app.get('/api/admin/reports/academy', ...secured, allow(ROLES.academyAdmin, 'ACADEMY'), async (_req, res) => {
  const [classes, students, applications, attendance] = await Promise.all([prisma.academicClass.findMany({ select: { id: true, name: true, _count: { select: { students: true } } }, orderBy: { name: 'asc' } }), prisma.academyStudent.count(), prisma.academyApplication.groupBy({ by: ['status'], _count: { _all: true } }), prisma.attendanceRecord.groupBy({ by: ['status'], _count: { _all: true } })]);
  res.json({ classes: classes.map((c:any)=>({name:c.name,students:c._count.students})), studentCount: students, applicationsByStatus: applications, attendanceByStatus: attendance });
});
app.get('/api/admin/finance/summary', ...secured, allow(ROLES.finance, 'CHURCH'), async (_req, res) => {
  const [verified, pending, failed] = await Promise.all([prisma.donation.aggregate({ where: { status: PaymentStatus.SUCCESS }, _sum: { amountKobo: true }, _count: true }), prisma.donation.count({ where: { status: PaymentStatus.PENDING } }), prisma.donation.count({ where: { status: PaymentStatus.FAILED } })]);
  res.json({ verifiedCount: verified._count, verifiedAmountNaira: (verified._sum.amountKobo || 0) / 100, pendingCount: pending, failedCount: failed });
});
app.get('/api/admin/finance/donations', ...secured, allow(ROLES.finance, 'CHURCH'), async (_req, res) => res.json(await prisma.donation.findMany({ take: 300, orderBy: { createdAt: 'desc' }, select: { reference: true, category: true, amountKobo: true, currency: true, anonymous: true, donorName: true, provider: true, status: true, verifiedAt: true, createdAt: true } })));

app.get('/health', async (_req, res) => { try { await prisma.$queryRaw`SELECT 1`; res.json({ status: 'ok', database: 'connected' }); } catch { res.status(503).json({ status: 'degraded', database: 'unavailable' }); } });
app.use((err: any, _req: any, res: any, _next: any) => { if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message }); if (err?.message === 'Unsupported file type') return res.status(415).json({ error: err.message }); console.error(err); res.status(500).json({ error: 'Internal server error' }); });
app.listen(PORT, () => console.log(`Hospital Chapel API listening on ${PORT}`));

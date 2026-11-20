import {PrismaClient,ApprovalStatus} from '@prisma/client';
const prisma=new PrismaClient();
async function main(){
 const leaders=[
  ['Olusoji Billyrose','Current Pastor','PASTOR'],
  ['Bro. Daniel Magaji','Secretary','SECRETARY'],
  ['Bro. David Habu Sulai','Assistant Secretary','SECRETARY'],
  ['Dr. John Dahosa','Board Chairman','BOARD'],
  ['Barr. Pastor A.S. Agari','Board Member','BOARD'],
  ['Prof. Pastor Ojji Dike','Board Member','BOARD'],
  ['Dr. Pastor Pius Idoko Ogolekwu','Board Member','BOARD'],
  ['Dr. Pastor David Barau','Board Member','BOARD']
 ];
 for(const [fullName,position,profileType] of leaders) await prisma.leaderProfile.upsert({
  where:{id:`seed-${fullName.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`},
  update:{},create:{id:`seed-${fullName.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,fullName,position,profileType,biography:'OFFICIAL BIOGRAPHY AWAITED',status:ApprovalStatus.DRAFT}
 }).catch(async()=>{await prisma.leaderProfile.create({data:{fullName,position,profileType,biography:'OFFICIAL BIOGRAPHY AWAITED',status:ApprovalStatus.DRAFT}}).catch(()=>{});});
 const departments=['Marriage and Counselling Committee','Brother Fellowship','Sisters Fellowship','Teenage Department','Children Department','Gospel Publication Group (GPG)','Healing Voices','Mission and Evangelism Unit','Hospital Visitation Unit','Building and Maintenance Committee','Elder Council','Security Department','Ushering Unit','Prayer Band Unit','Youth Fellowship','Church Administration','Follow-up and Counselling Unit','Medical Committee'];
 for(const name of departments) await prisma.department.upsert({where:{name},update:{},create:{name,category:'MINISTRY_OR_COMMITTEE',description:'OFFICIAL DESCRIPTION AWAITED',functions:'To be supplied and approved by the church.',termsOfReference:'OFFICIAL TERMS OF REFERENCE AWAITED',status:ApprovalStatus.DRAFT}});
 for(let number=1;number<=12;number++) await prisma.familyUnit.upsert({where:{number},update:{},create:{number,name:`Family Unit ${number}`,functions:'OFFICIAL UNIT DETAILS AWAITED',status:ApprovalStatus.DRAFT}});
 await prisma.annualTheme.upsert({where:{year:2025},update:{},create:{year:2025,title:'Divine Enlargement',exposition:'OFFICIAL EXPOSITION AWAITED',status:ApprovalStatus.DRAFT}});
 await prisma.annualTheme.upsert({where:{year:2026},update:{},create:{year:2026,title:'Divine Passover',exposition:'OFFICIAL EXPOSITION AND MONTHLY SUBTOPICS AWAITED',bibleReference:'OFFICIAL THEME SCRIPTURE AWAITED',status:ApprovalStatus.DRAFT}});
 for (const year of [2025,2026]) { const theme=await prisma.annualTheme.findUnique({where:{year}}); if(theme) for(let month=1;month<=12;month++) await prisma.monthlyTheme.upsert({where:{annualThemeId_month:{annualThemeId:theme.id,month}},update:{},create:{annualThemeId:theme.id,month,subtitle:null,bibleReference:null,teachingMaterialUrl:null}}); }
 console.log('Seeded supplied leadership names, 18 departments, 12 family units and 2025/2026 themes as unpublished drafts.');
}
main().finally(()=>prisma.$disconnect());

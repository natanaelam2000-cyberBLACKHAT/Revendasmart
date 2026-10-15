import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import sharp from 'sharp';
import { ADS_PRO_BACKGROUND_CATALOG } from '../shared/ads-pro/background-catalog';
import { ADS_PRO_APPROVED_STATIC_BACKGROUNDS } from '../shared/ads-pro/approved-static-backgrounds';
import { AUDIT_BUCKETS, AUDIT_STYLES } from '../shared/ads-pro/background-audit';
import { buildAdsProProductFacts } from '../shared/ads-pro/ad-product-facts';
import { generateAdsProVariations, rankAdsProBackgroundsForFacts } from '../shared/ads-pro/ad-variations';
const report=JSON.parse(readFileSync('docs/ads-pro/background-audit/report.json','utf8'));
assert.equal(report.summary.SOURCE_BACKGROUND_COUNT,309);
assert.equal(report.summary.VALID_BACKGROUNDS,300);
assert.equal(ADS_PRO_APPROVED_STATIC_BACKGROUNDS.length,300);
const ids=new Set(ADS_PRO_APPROVED_STATIC_BACKGROUNDS.map(e=>e.id));
assert.equal(ids.size,300);
assert.deepEqual([...ids].sort(),report.decisions.filter((d: {status: string})=>d.status==='approved').map((d: {id: string})=>d.id).sort());
for(const e of ADS_PRO_APPROVED_STATIC_BACKGROUNDS){
 const p=`client/public/ads-pro/backgrounds/${e.id}.webp`;
 const t=`client/public/ads-pro/backgrounds/thumbs/${e.id}.webp`;
 assert.ok(existsSync(p)&&existsSync(t));
 const m=await sharp(p).metadata();
 await sharp(p,{failOn:'warning'}).raw().toBuffer();
 await sharp(t,{failOn:'warning'}).raw().toBuffer();
 assert.equal(m.format,'webp'); assert.equal(m.width,e.width); assert.equal(m.height,e.height);
 assert.ok(Math.max(e.width,e.height)<=1350);
 assert.equal((await sharp(t).metadata()).width,200);
}
assert.equal(readdirSync('client/public/ads-pro/backgrounds').filter(n=>n.endsWith('.webp')).length,300);
assert.deepEqual(readdirSync('client/public/ads-pro/backgrounds').filter(n=>n.endsWith('.webp')).sort(),[...ids].map(id=>`${id}.webp`).sort());
assert.deepEqual(readdirSync('client/public/ads-pro/backgrounds/thumbs').sort(),[...ids].map(id=>`${id}.webp`).sort());
assert.equal(new Set(report.decisions.map((d:{relativePath:string})=>d.relativePath.toLowerCase())).size,309);
for(const bucket of AUDIT_BUCKETS)assert.ok(ADS_PRO_APPROVED_STATIC_BACKGROUNDS.some(e=>e.bucket===bucket),bucket);
for(const style of AUDIT_STYLES)assert.ok(ADS_PRO_APPROVED_STATIC_BACKGROUNDS.some(e=>e.style===style),style);
const samples=['doces','alimentos','eletronicos','cosmeticos perfumes','roupas','acessorios','papelaria','casa decoracao','utilidades','outros'];
for(const category of samples)for(const style of AUDIT_STYLES)for(const format of ['portrait','square'] as const){
 const facts=buildAdsProProductFacts({id:category,name:category,category,salePrice:129.9});
 const input={facts,preferredStyles:[style],style,intent:'spotlight' as const,format,storeName:'Loja',manifest:ADS_PRO_BACKGROUND_CATALOG.manifest,library:ADS_PRO_BACKGROUND_CATALOG.library};
 const ranked=rankAdsProBackgroundsForFacts(input);assert.ok(ranked.some(r=>r.asset.sourceType==='STATIC_ASSET'));
 for(const r of ranked)assert.ok(ADS_PRO_BACKGROUND_CATALOG.manifest.assets.some(a=>a.id===r.asset.id));
 const variants=generateAdsProVariations(input);assert.ok(variants.length>=3);
 assert.deepEqual(variants,generateAdsProVariations(input));
 assert.equal(variants[0].doc.direction.style,style);
 assert.equal(new Set(variants.map(v=>v.doc.background.id)).size,variants.length);
}
console.log('PASS: 309 sources, 300 approved WebP + thumbnails, 10 buckets, 5 styles, 100 deterministic matcher/profile/format scenarios.');

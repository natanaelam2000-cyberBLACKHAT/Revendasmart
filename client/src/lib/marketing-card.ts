import { getImage } from "@/lib/mock-data";

export interface MarketingCardPayload {
  productName: string; imageUrl?: string; photoUrl?: string; image?: string; imageId?: string;
  price: string; headline: string; storeName: string; primaryColor: string;
}
const loadHtmlImage = (src:string) => new Promise<HTMLImageElement|null>(resolve=>{
  const image=new Image(); const timer=window.setTimeout(()=>resolve(null),10000);
  image.onload=()=>{window.clearTimeout(timer);resolve(image);};
  image.onerror=()=>{window.clearTimeout(timer);resolve(null);};
  image.src=src;
});
async function loadRemoteImage(url:string):Promise<HTMLImageElement|null>{
  try {
    const response=await fetch(url,{mode:"cors",cache:"force-cache"});
    if(response.ok){const blob=await response.blob();const objectUrl=URL.createObjectURL(blob);const image=await loadHtmlImage(objectUrl);URL.revokeObjectURL(objectUrl);if(image)return image;}
  } catch { /* direct image fallback below */ }
  return loadHtmlImage(url);
}
async function resolveProductImage(payload:MarketingCardPayload):Promise<HTMLImageElement|null>{
  const candidates=[payload.imageUrl,payload.photoUrl,payload.image].filter((value):value is string=>typeof value==="string"&&value.trim().length>0);
  for(const candidate of candidates){const image=await loadRemoteImage(candidate.trim());if(image)return image;}
  if(payload.imageId){try{const stored=await getImage(payload.imageId);if(stored){const image=await loadHtmlImage(stored);if(image)return image;}}catch{/* placeholder below */}}
  return null;
}
function drawImagePlaceholder(ctx:CanvasRenderingContext2D,color:string){
  ctx.fillStyle="#f8fafc";ctx.beginPath();ctx.roundRect(290,255,500,400,44);ctx.fill();
  ctx.strokeStyle="#e2e8f0";ctx.lineWidth=4;ctx.stroke();
  ctx.fillStyle=color;ctx.globalAlpha=.16;ctx.beginPath();ctx.arc(540,405,74,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
  ctx.fillStyle="#94a3b8";ctx.font="700 26px sans-serif";ctx.fillText("Produto sem imagem disponível",540,535);
}
export async function createMarketingCard(payload:MarketingCardPayload):Promise<Blob>{
  const canvas=document.createElement("canvas");const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Não foi possível preparar a imagem");
  canvas.width=1080;canvas.height=1080;const color=payload.primaryColor||"#ec4899";
  const gradient=ctx.createLinearGradient(0,0,1080,1080);gradient.addColorStop(0,color);gradient.addColorStop(1,"#ffffff");ctx.fillStyle=gradient;ctx.fillRect(0,0,1080,1080);
  ctx.fillStyle="#ffffff";ctx.shadowColor="rgba(0,0,0,.12)";ctx.shadowBlur=50;ctx.beginPath();ctx.roundRect(100,100,880,880,80);ctx.fill();ctx.shadowBlur=0;
  ctx.fillStyle=color;ctx.font="900 40px sans-serif";ctx.textAlign="center";ctx.fillText((payload.storeName||"RevendaSmart").toUpperCase().slice(0,35),540,190);
  const productImage=await resolveProductImage(payload);
  if(productImage){const ratio=Math.min(500/productImage.naturalWidth,400/productImage.naturalHeight);const width=productImage.naturalWidth*ratio,height=productImage.naturalHeight*ratio;ctx.drawImage(productImage,540-width/2,455-height/2,width,height);}else{drawImagePlaceholder(ctx,color);}
  ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(260,710,560,82,41);ctx.fill();ctx.fillStyle="#ffffff";ctx.font="900 30px sans-serif";ctx.fillText(payload.headline.slice(0,34),540,762);
  ctx.fillStyle="#1f2937";ctx.font="900 48px sans-serif";ctx.fillText(payload.productName.slice(0,32),540,875);ctx.fillStyle=color;ctx.font="900 72px sans-serif";ctx.fillText(`R$ ${payload.price}`,540,965);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Não foi possível gerar o PNG")),"image/png",.92));
}
export function downloadMarketingCard(blob:Blob,productName:string){const url=URL.createObjectURL(blob);const link=document.createElement("a");link.download=`anuncio-${productName.toLowerCase().replace(/[^a-z0-9]+/gi,"-")}.png`;link.href=url;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),3000);}

/* Isometric canvas renderer. All geometry is native canvas; no SVG dependencies. */
const THEMES = {
  dawn:['#718dc7','#344a7c'],dusk:['#7b6ca5','#3d365d'],lagoon:['#63aaa8','#245964'],rose:['#c48d9e','#754b71'],night:['#354667','#142339'],sand:['#d7b58e','#8e6f62'],aurora:['#0b5960','#082b40'],nebula:['#292265','#090d30'],ember:['#713d3a','#302133']
};
const SKINS = {
  classic:['#ffdf04','#f8ca06','#ffda05','#9d821a'],mint:['#9ce7c8','#5fbd9c','#7fd8b4','#438c78'],coral:['#ff9d81','#e16d5a','#fa876f','#a45247'],lilac:['#f4eff6','#d1c7d8','#e4dce8','#82788e'],midnight:['#7761bb','#271c66','#4a358e','#211d4a'],honey:['#bd8854','#684127','#91603c','#573d2a'],glass:['#ccf6ff','#71bed4','#a5dfec','rgba(221,253,255,.85)'],gold:['#ffe894','#b97916','#edbf42','#8b5a14'],glitter:['#d3b8ff','#7456a8','#a18bd0','#574573'],obsidian:['#657587','#1a2230','#323f51','#111820']
};
const TEXTURED_SKINS=['mint','coral','lilac','midnight','honey'];
const MATERIAL_SKINS=new Set(['glass','gold','glitter','obsidian']);
// This is the null vector of projectRaw's two screen axes. Depth comparisons
// therefore refer to the same camera as projection, including while rotating.
const EYE = [.57*.79,.79,.85+.57*.47];
const faceDefs = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
const normal = (a,b,c) => {let u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];};
const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
const smooth=t=>1-Math.pow(1-t,3);
const key=(x,y)=>`${x},${y}`;
const dims=s=>s.o===1?[2,1,1]:s.o===2?[1,2,1]:[1,1,2];
function vertices(s){const [w,d,h]=dims(s),x=s.x,y=s.y;return [[x,y,0],[x+w,y,0],[x+w,y+d,0],[x,y+d,0],[x,y,h],[x+w,y,h],[x+w,y+d,h],[x,y+d,h]];}
function rotation(s,dir,a){const [w,d]=dims(s),ax=dir==='left'?s.x:s.x+w,ay=dir==='up'?s.y:s.y+d;return p=>{let [x,y,z]=p,c=Math.cos(a),sn=Math.sin(a);if(dir==='right'||dir==='left'){const q=x-ax;return [ax+q*c+z*sn,y,-q*sn+z*c];}const q=y-ay;return [x,ay+q*c-z*sn,q*sn+z*c];};}
function rawNext(s,dir){let {x,y,o,mask=0}=s;if(dir==='left'){x-=o===0?2:1;if(o!==2)o=o===0?1:0;}if(dir==='right'){x+=o===1?2:1;if(o!==2)o=o===0?1:0;}if(dir==='up'){y-=o===0?2:1;if(o!==1)o=o===0?2:0;}if(dir==='down'){y+=o===2?2:1;if(o!==1)o=o===0?2:0;}return{x,y,o,mask};}

/** Sutherland–Hodgman clipping, shared by world planes and screen depth planes. */
function clipPolygon(points,distance){
  if(!points.length)return [];
  const result=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],da=distance(a),db=distance(b),insideA=da>=-1e-8,insideB=db>=-1e-8;
    if(insideA)result.push(a);
    if(insideA!==insideB){const t=da/(da-db);result.push(a.map((v,j)=>v+(b[j]-v)*t));}
  }
  return result.filter((p,i)=>p.some((n,j)=>Math.abs(n-result[(i+result.length-1)%result.length][j])>1e-8));
}
function projectedSurface(points,project){
  const screen=points.map(p=>{const q=project(...p);return[q.x,q.y,dot(p,EYE)];});
  if(screen.length<3)return null;
  const a=screen[0],b=screen[1];let d=screen[2],ux=b[0]-a[0],uy=b[1]-a[1],vx=d[0]-a[0],vy=d[1]-a[1],det=ux*vy-uy*vx;
  for(let i=3;Math.abs(det)<1e-7&&i<screen.length;i++){d=screen[i];vx=d[0]-a[0];vy=d[1]-a[1];det=ux*vy-uy*vx;}
  if(Math.abs(det)<1e-7)return null;
  const du=b[2]-a[2],dv=d[2]-a[2],dx=(du*vy-dv*uy)/det,dy=(ux*dv-vx*du)/det;
  return{points:screen,plane:[dx,dy,a[2]-dx*a[0]-dy*a[1]],bounds:[Math.min(...screen.map(p=>p[0])),Math.min(...screen.map(p=>p[1])),Math.max(...screen.map(p=>p[0])),Math.max(...screen.map(p=>p[1]))]};
}
function occlusionPolygon(surface,occluder){
  const a=surface.bounds,b=occluder.bounds;
  if(a[2]<=b[0]||b[2]<=a[0]||a[3]<=b[1]||b[3]<=a[1])return [];
  const delta=occluder.plane.map((n,i)=>n-surface.plane[i]);
  // Equal planes are contact, not an occluder. This also avoids coplanar flicker.
  return clipPolygon(occluder.points,p=>delta[0]*p[0]+delta[1]*p[1]+delta[2]-1e-6);
}
function tileFaces(x,y,goal=false){
  const faces=[[[x+1,y,0],[x+1,y+1,0],[x+1,y+1,-.23],[x+1,y,-.23]],[[x,y+1,0],[x+1,y+1,0],[x+1,y+1,-.23],[x,y+1,-.23]]];
  // A goal is an aperture, never a solid top that the block must fade through.
  if(!goal)faces.push([[x,y,0],[x+1,y,0],[x+1,y+1,0],[x,y+1,0]]);
  return faces;
}
function fallPlan(level,from,dir){
  const to=rawNext(from,dir),[w,d]=dims(to),before=new Set();
  const [fw,fd]=dims(from);for(let x=0;x<fw;x++)for(let y=0;y<fd;y++)before.add(key(from.x+x,from.y+y));
  for(const button of level.switches||[])if(button.at[0]>=to.x&&button.at[0]<to.x+w&&button.at[1]>=to.y&&button.at[1]<to.y+d&&!before.has(key(...button.at)))to.mask^=1<<button.bit;
  const bridge=new Map((level.bridges||[]).map(b=>[key(...b.at),b.bit])),fragile=new Set((level.fragile||[]).map(p=>key(...p))),tiles=new Set(level.tiles.map(p=>key(...p))),support=[],broken=[];
  for(let x=0;x<w;x++)for(let y=0;y<d;y++){
    const px=to.x+x,py=to.y+y,k=key(px,py);
    if(to.o===0&&fragile.has(k)){broken.push(k);continue;}
    if(tiles.has(k)&&(!bridge.has(k)||to.mask&(1<<bridge.get(k))))support.push([px,py]);
  }
  if(broken.length)return{to,dir,broken,collapse:true};
  let tip=dir,pivot;
  if(support.length&&w===2){tip=support[0][0]===to.x?'right':'left';pivot=to.x+1;}
  else if(support.length&&d===2){tip=support[0][1]===to.y?'down':'up';pivot=to.y+1;}
  else pivot=dir==='right'?to.x:dir==='left'?to.x+w:dir==='down'?to.y:to.y+d;
  return{to,dir:tip,pivot,broken,collapse:false};
}
function fallTransform(plan,t){
  if(plan.collapse)return p=>[p[0],p[1],p[2]-6.5*t*t];
  const hinge=Math.min(1,t/.63),angle=Math.PI/2*hinge*hinge,sign=plan.dir==='right'||plan.dir==='up'?1:-1,c=Math.cos(sign*angle),s=Math.sin(sign*angle),flight=Math.max(0,(t-.63)/.37),dx=plan.dir==='right'?1:plan.dir==='left'?-1:0,dy=plan.dir==='down'?1:plan.dir==='up'?-1:0;
  return p=>{
    const[x,y,z]=p;
    const q=dx?[plan.pivot+(x-plan.pivot)*c+z*s,y,-(x-plan.pivot)*s+z*c]:[x,plan.pivot+(y-plan.pivot)*c-z*s,(y-plan.pivot)*s+z*c];
    return[q[0]+dx*flight*.8,q[1]+dy*flight*.8,q[2]-6.5*flight*flight];
  };
}
export class Renderer {
  constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:true});this.theme='dawn';this.skin='classic';this.textures={};for(const id of TEXTURED_SKINS){const img=new Image();img.src=new URL('./assets/'+id+'.png?v=20261016-200',import.meta.url).href;this.textures[id]=img;}this.state={x:0,y:0,o:0,mask:0};this.mode='game';this.hint=null;this.level=null;this.anim=null;this.winParticles=[];this.reducedMotion=false;this.demo=false;this.destroyed=false;this.camera={scale:30,x:210,y:390};this.resize=this.resize.bind(this);this.tick=this.tick.bind(this);this.resizeObserver=new ResizeObserver(this.resize);this.resizeObserver.observe(canvas);this.resize();this.frame=requestAnimationFrame(this.tick);}
  setTheme(id){this.theme=THEMES[id]?id:'dawn';}
  setSkin(id){this.skin=SKINS[id]?id:'classic';}
  setLevel(level,state){this.level=level;this.state={...(state||level.start)};this.anim=null;this.blockHidden=false;this.brokenTiles=[];this.hint=null;this.winParticles=[];this.fit();}
  setState(state){this.state={...state};this.anim=null;this.blockHidden=false;this.brokenTiles=[];}
  setMode(mode){this.mode=mode;this.fit();}
  setDemo(value){this.demo=!!value;}
  setReducedMotion(value){this.reducedMotion=!!value;}
  setHint(dir){this.hint=dir||null;this.hintSince=performance.now();}
  resize(){const rect=this.canvas.getBoundingClientRect();this.width=rect.width||420;this.height=rect.height||780;const dpr=Math.min(window.devicePixelRatio||1,2.5);this.canvas.width=Math.round(this.width*dpr);this.canvas.height=Math.round(this.height*dpr);this.ctx.setTransform(dpr,0,0,dpr,0,0);this.dpr=dpr;this.fit();}
  fit(){
    if(!this.level||!this.width)return;
    const pts=[];for(const[x,y]of this.level.tiles)pts.push(this.projectRaw(x,y,0),this.projectRaw(x+1,y,0),this.projectRaw(x+1,y+1,0),this.projectRaw(x,y+1,0));
    if(!pts.length)return;
    const minX=Math.min(...pts.map(p=>p.x)),maxX=Math.max(...pts.map(p=>p.x)),minY=Math.min(...pts.map(p=>p.y)),maxY=Math.max(...pts.map(p=>p.y));
    if(this.mode==='rules'){
      // Reserve the lower half for explanatory text and navigation on short phones.
      // Include a full standing block and tile thickness in the scene bounds.
      const top=minY-1.58,bottom=maxY+.18;
      const scale=Math.min(this.width*.82/Math.max(maxX-minX,1),this.height*.27/Math.max(bottom-top,1),this.width*.075);
      this.camera={scale,x:this.width/2-(minX+maxX)/2*scale,y:this.height*.32-(top+bottom)/2*scale};
      return;
    }
    let scale=Math.min(this.width*.88/Math.max(maxX-minX,1),this.height*.37/Math.max(maxY-minY+1.1,1),this.width*.091);
    if(this.mode==='home')scale*=.89;
    this.camera={scale,x:this.width/2-(minX+maxX)/2*scale,y:this.height*(this.mode==='home'?.43:.51)-(minY+maxY)/2*scale};
  }
  projectRaw(x,y,z=0){return{x:x-.57*y,y:.47*x+.85*y-.79*z};}
  project(x,y,z=0){const p=this.projectRaw(x,y,z);return{x:this.camera.x+p.x*this.camera.scale,y:this.camera.y+p.y*this.camera.scale};}
  animateMove(from,to,dir,onDone){this.hint=null;this.blockHidden=false;this.anim={type:'move',from:{...from},to:{...to},dir,start:performance.now(),duration:this.reducedMotion?1:205,onDone};}
  animateFall(state,dir,onDone){this.hint=null;this.blockHidden=false;const plan=fallPlan(this.level,state,dir);this.anim={type:'fall',from:{...state},to:plan.to,plan,dir,start:performance.now(),duration:this.reducedMotion?100:940,onDone};}
  animateWin(onDone){this.hint=null;this.blockHidden=false;const p=this.project(this.state.x+.5,this.state.y+.5,0);for(let i=0;i<(this.reducedMotion?0:28);i++)this.winParticles.push({x:p.x,y:p.y,vx:(Math.random()-.5)*95,vy:-35-Math.random()*100,life:1,color:['#ffdc32','#ffffff','#a6dfe1'][i%3],size:2+Math.random()*2});this.anim={type:'win',from:{...this.state},start:performance.now(),duration:this.reducedMotion?100:720,onDone};}
  poly(points,fill,stroke='#a3a49f',line=1.4){const c=this.ctx;c.beginPath();for(let i=0;i<points.length;i++){const p=Array.isArray(points[i])?this.project(...points[i]):points[i];i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);}c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=line;c.lineJoin='round';c.stroke();}}
  tick(time){if(this.destroyed)return;const dt=Math.min((time-(this.lastTime||time))/1000,.05);this.lastTime=time;this.render(time,dt);this.frame=requestAnimationFrame(this.tick);}
  render(time,dt){
    const c=this.ctx;c.clearRect(0,0,this.width,this.height);this.materialTime=this.reducedMotion?0:time;if(!this.level)return;
    const level=this.level,state=this.state,anim=this.anim,t=anim?Math.max(0,Math.min(1,(time-anim.start)/anim.duration)):0;
    let transform=p=>p,drawState=state,mask=state.mask||0,broken=this.brokenTiles||[];
    if(anim){
      if(anim.type==='move'){
        drawState=anim.from;const sign=anim.dir==='right'||anim.dir==='up'?1:-1;transform=rotation(drawState,anim.dir,sign*Math.PI/2*smooth(t));if(t>.75)mask=anim.to.mask||0;
      }else if(anim.type==='fall'){
        const landing=.24;
        if(t<landing){drawState=anim.from;const sign=anim.dir==='right'||anim.dir==='up'?1:-1;transform=rotation(drawState,anim.dir,sign*Math.PI/2*smooth(t/landing));}
        else{drawState=anim.to;transform=fallTransform(anim.plan,(t-landing)/(1-landing));mask=anim.to.mask||0;broken=anim.plan.broken;}
      }else if(anim.type==='win'){
        drawState=anim.from;const descent=4.2*t*t;transform=p=>[p[0],p[1],p[2]-descent];
      }
    }
    const fragile=new Set((level.fragile||[]).map(p=>key(...p))),switches=new Map((level.switches||[]).map(b=>[key(...b.at),b.bit])),bridges=new Map((level.bridges||[]).map(b=>[key(...b.at),b.bit]));
    const tiles=[...level.tiles].sort((a,b)=>a[0]*EYE[0]+a[1]*EYE[1]-b[0]*EYE[0]-b[1]*EYE[1]),occluders=[];
    for(const[x,y]of tiles){
      const k=key(x,y),bridge=bridges.has(k),active=(!bridge||!!(mask&(1<<bridges.get(k))))&&!broken.includes(k),goal=x===level.goal[0]&&y===level.goal[1];
      if(!active){if(bridge)this.drawBridgeGhost(x,y,bridges.get(k));continue;}
      this.drawTile(x,y,goal,fragile.has(k),bridge,bridges.get(k)||0);
      for(const face of tileFaces(x,y,goal)){const surface=projectedSurface(face,(...p)=>this.project(...p));if(surface)occluders.push(surface);}
      if(switches.has(k))this.drawSwitch(x,y,!!(mask&(1<<switches.get(k))),time,switches.get(k));
    }
    if(!this.blockHidden)this.drawBlock(drawState,transform,occluders,anim?.type==='win'?level.goal:null);
    if(anim&&t>=1){this.anim=null;if(anim.type==='move')this.state={...anim.to};else{this.blockHidden=true;this.brokenTiles=broken;}const fn=anim.onDone;if(fn)queueMicrotask(fn);}
    if(this.hint&&!this.anim)this.drawHint(this.hint,time);
    for(const p of this.winParticles){p.vy+=100*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt*1.4;c.globalAlpha=Math.max(0,p.life);c.fillStyle=p.color;c.fillRect(p.x,p.y,p.size,p.size*1.6);}c.globalAlpha=1;this.winParticles=this.winParticles.filter(p=>p.life>0);
  }
  drawTile(x,y,goal,fragile,bridge,bit=0){const purple=bit===1;const border=bridge?(purple?'#a18abc':'#79a6a5'):fragile?'#bb9980':'#a2a39f';this.poly([[x+1,y,0],[x+1,y+1,0],[x+1,y+1,-.23],[x+1,y,-.23]],bridge?(purple?'#c9b8db':'#a9d0c8'):fragile?'#d8b79d':'#e1e2dd',border,1.15);this.poly([[x,y+1,0],[x+1,y+1,0],[x+1,y+1,-.23],[x,y+1,-.23]],bridge?(purple?'#d5c8e6':'#badcd6'):fragile?'#e6c7ad':'#f5f5f1',border,1.15);if(goal){this.poly([[x,y,0],[x+1,y,0],[x+1,y+1,0],[x,y+1,0]],'#3b3d3d','#929591',1.5);const a=this.project(x,y),b=this.project(x+1,y),d=this.project(x,y+1),cc=this.project(x+1,y+1),c=this.ctx;c.save();this.path([a,b,cc,d].map(p=>[p.x,p.y]));c.clip();this.poly([[x,y,0],[x+1,y,0],[x+1,y,-.85],[x,y,-.85]],'#505250',null);this.poly([[x,y,0],[x,y+1,0],[x,y+1,-.85],[x,y,-.85]],'#626461',null);c.restore();this.poly([a,b,cc,d],null,'#949691',1.4);}else{this.poly([[x,y,0],[x+1,y,0],[x+1,y+1,0],[x,y+1,0]],bridge?(purple?'#f0e8f8':'#e4f2ed'):fragile?'#f7d4b6':'#fdfefa',border,1.45);if(fragile){const c=this.ctx;c.save();c.strokeStyle='#c99b7a';c.lineWidth=1.1;const points=[[x+.25,y+.3,.006],[x+.48,y+.45,.006],[x+.35,y+.62,.006],[x+.65,y+.72,.006]];c.beginPath();points.forEach((p,i)=>{const q=this.project(...p);i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y);});c.stroke();c.restore();}if(bridge)this.drawCircuitMark(x,y,bit,false);}}
  drawBridgeGhost(x,y,bit=0){const c=this.ctx;c.save();c.globalAlpha=.65;c.setLineDash([3,4]);this.poly([[x+.08,y+.08,-.03],[x+.92,y+.08,-.03],[x+.92,y+.92,-.03],[x+.08,y+.92,-.03]],bit===1?'rgba(232,214,255,.08)':'rgba(217,246,241,.07)',bit===1?'#d6c0ee':'#b7d9d5',1);c.restore();this.drawCircuitMark(x,y,bit,true);}
  drawCircuitMark(x,y,bit=0,ghost=false){const c=this.ctx,p=this.project(x+.5,y+.5,.024),count=bit===1?2:1,r=Math.max(1.4,this.camera.scale*.06),space=r*2.65;c.save();c.fillStyle=ghost?(bit===1?'#e2cdf9':'#d0ede7'):(bit===1?'#8a68b1':'#428f86');c.strokeStyle=ghost?'rgba(53,69,99,.25)':'rgba(255,255,255,.65)';c.lineWidth=.65;for(let i=0;i<count;i++){c.beginPath();c.arc(p.x+(i-(count-1)/2)*space,p.y,r,0,Math.PI*2);c.fill();c.stroke();}c.restore();}
  drawSwitch(x,y,on,time,bit=0){const c=this.ctx,p=this.project(x+.5,y+.5,.01),purple=bit===1;c.save();c.translate(p.x,p.y);c.transform(1,.47,-.57,.85,0,0);c.strokeStyle=purple?(on?'#8664a6':'#b09acb'):(on?'#409c8c':'#68b4a9');c.fillStyle=purple?(on?'#c7acdf':'#e9def4'):(on?'#a0dfca':'#d2eae2');c.lineWidth=1.8;const r=this.camera.scale*.27;c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.fill();c.stroke();c.restore();this.drawCircuitMark(x,y,bit,false);}
  drawBlock(state,transform=p=>p,occluders=[],portal=null){
    const color=SKINS[this.skin],v=vertices(state).map(transform),faces=[],c=this.ctx,scale=this.camera.scale;
    let cuts=[];
    if(state.o===0){const z=1;cuts=[[[state.x,state.y,z],[state.x+1,state.y,z]],[[state.x+1,state.y,z],[state.x+1,state.y+1,z]],[[state.x+1,state.y+1,z],[state.x,state.y+1,z]],[[state.x,state.y+1,z],[state.x,state.y,z]]];}
    else if(state.o===1){const x=state.x+1;cuts=[[[x,state.y,0],[x,state.y,1]],[[x,state.y+1,0],[x,state.y+1,1]],[[x,state.y,1],[x,state.y+1,1]]];}
    else{const y=state.y+1;cuts=[[[state.x,y,0],[state.x,y,1]],[[state.x+1,y,0],[state.x+1,y,1]],[[state.x,y,1],[state.x+1,y,1]]];}
    for(const def of faceDefs){
      const basis=def.map(i=>v[i]),n=normal(basis[0],basis[1],basis[2]);if(dot(n,EYE)<=.0001)continue;
      const depth=basis.reduce((sum,p)=>sum+dot(p,EYE),0)/4,zn=n[2]/Math.hypot(...n),fill=zn>.5?color[0]:n[0]>n[1]?color[1]:color[2];
      if(portal){
        const above=clipPolygon(basis,p=>p[2]),below=clipPolygon(basis,p=>-p[2]);
        if(above.length>=3)faces.push({pts:above,basis,n,depth,fill,below:false});
        if(below.length>=3&&basis.some(p=>p[2]<-1e-7))faces.push({pts:below,basis,n,depth,fill,below:true});
      }else faces.push({pts:basis,basis,n,depth,fill});
    }
    faces.sort((a,b)=>a.depth-b.depth);
    for(const face of faces){
      const surface=projectedSurface(face.pts,(...p)=>this.project(...p));if(!surface)continue;
      c.save();this.path(surface.points);c.clip();
      if(face.below){const[x,y]=portal;this.path([[x,y,0],[x+1,y,0],[x+1,y+1,0],[x,y+1,0]].map(p=>{const q=this.project(...p);return[q.x,q.y];}));c.clip();}
      // Cut only the part of each tile surface that is closer to the camera.
      // Repeated inverse clips subtract a union, unlike one even-odd path whose
      // overlapping tile sides could otherwise reveal the block again.
      for(const occluder of occluders){
        const hidden=occlusionPolygon(surface,occluder);if(hidden.length<3)continue;
        c.beginPath();c.rect(-2,-2,this.width+4,this.height+4);this.path(hidden,false);c.clip('evenodd');
      }
      this.drawBlockFace(face,color[3],Math.max(1.25,scale*.04));
      for(const cut of cuts){
        const a=transform(cut[0]),b=transform(cut[1]),distance=p=>dot(p.map((n,i)=>n-face.basis[0][i]),face.n);
        if(Math.abs(distance(a))>.001||Math.abs(distance(b))>.001)continue;
        const pa=this.project(...a),pb=this.project(...b);c.beginPath();c.moveTo(pa.x,pa.y);c.lineTo(pb.x,pb.y);c.strokeStyle=color[3];c.lineWidth=Math.max(1.1,scale*.033);c.stroke();
      }
      if(face.below){const darkness=Math.min(.62,Math.max(0,-face.pts.reduce((n,p)=>n+p[2],0)/face.pts.length)*.3);this.poly(face.pts,`rgba(30,35,42,${darkness})`,null);}
      c.restore();
    }
  }
  path(points,begin=true){const c=this.ctx;if(begin)c.beginPath();points.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.closePath();}
  drawBlockFace(face,border,line){
    if(MATERIAL_SKINS.has(this.skin)){this.drawMaterialFace(face);this.poly(face.basis||face.pts,null,border,line);return;}
    this.poly(face.pts,face.fill,null);
    const texture=this.textures?.[this.skin];
    if(this.skin!=='classic'&&texture?.complete&&texture.naturalWidth){
      const c=this.ctx,basis=face.basis||face.pts,p=basis.map(q=>this.project(...q)),a=basis[0],b=basis[1],d=basis[3],length=q=>Math.hypot(...q.map((v,i)=>v-a[i]));
      const texels=96,width=texels*length(b),height=texels*length(d);
      c.save();c.beginPath();p.forEach((q,i)=>i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y));c.closePath();c.clip();
      c.transform((p[1].x-p[0].x)/width,(p[1].y-p[0].y)/width,(p[3].x-p[0].x)/height,(p[3].y-p[0].y)/height,p[0].x,p[0].y);
      c.imageSmoothingEnabled=true;
      if(['lilac','midnight','honey'].includes(this.skin))c.drawImage(texture,0,0,width,height);
      else{const pattern=c.createPattern(texture,'repeat');if(pattern){c.fillStyle=pattern;c.fillRect(0,0,width,height);}}
      const nz=face.n[2]/Math.hypot(...face.n),shade=nz>.5?.015:face.n[0]>face.n[1]?.17:.07;
      c.fillStyle=`rgba(18,24,38,${shade})`;c.fillRect(0,0,width,height);c.restore();
    }
    this.poly(face.basis||face.pts,null,border,line);
  }
  drawMaterialFace(face){
    const c=this.ctx,basis=face.basis||face.pts,p=basis.map(q=>this.project(...q)),a=basis[0],length=q=>Math.hypot(...q.map((v,i)=>v-a[i])),w=96*length(basis[1]),h=96*length(basis[3]);
    // Paint in each rigid face's coordinates. All materials inherit the same
    // depth clips as the solid mesh, including a fall and the goal aperture.
    c.save();c.transform((p[1].x-p[0].x)/w,(p[1].y-p[0].y)/w,(p[3].x-p[0].x)/h,(p[3].y-p[0].y)/h,p[0].x,p[0].y);
    const nz=face.n[2]/Math.hypot(...face.n),right=face.n[0]>face.n[1];
    if(this.skin==='glass'){
      const g=c.createLinearGradient(0,0,w,h);for(const[t,color]of[[0,'rgba(229,253,255,.62)'],[.25,'rgba(105,201,227,.28)'],[.58,'rgba(107,183,221,.14)'],[1,'rgba(219,251,255,.42)']])g.addColorStop(t,color);c.fillStyle=g;c.fillRect(0,0,w,h);
      c.fillStyle='rgba(233,255,255,.28)';c.beginPath();c.moveTo(w*.06,0);c.lineTo(w*.3,0);c.lineTo(w*.76,h);c.lineTo(w*.63,h);c.closePath();c.fill();
      c.fillStyle='rgba(255,255,255,.35)';c.beginPath();c.moveTo(w*.37,0);c.lineTo(w*.43,0);c.lineTo(w*.9,h);c.lineTo(w*.86,h);c.closePath();c.fill();
      c.strokeStyle='rgba(230,255,255,.62)';c.lineWidth=1.9;c.strokeRect(3,3,w-6,h-6);c.strokeStyle='rgba(68,144,177,.27)';c.strokeRect(7,7,w-14,h-14);
    }else if(this.skin==='gold'){
      const g=c.createLinearGradient(0,h*.06,w,h*.5);for(const[t,color]of[[0,'#7a4210'],[.12,'#d29424'],[.27,'#fff0a6'],[.34,'#fff9d5'],[.4,'#edc552'],[.61,'#bc7b11'],[.72,'#e2af36'],[.83,'#fff0a1'],[1,'#b97816']])g.addColorStop(t,color);c.fillStyle=g;c.fillRect(0,0,w,h);
      const shade=c.createLinearGradient(0,0,0,h);shade.addColorStop(0,'rgba(255,249,202,.24)');shade.addColorStop(.47,'rgba(255,221,117,0)');shade.addColorStop(1,'rgba(87,43,4,.25)');c.fillStyle=shade;c.fillRect(0,0,w,h);
      c.strokeStyle='rgba(255,242,181,.56)';c.lineWidth=2;c.strokeRect(2.2,2.2,w-4.4,h-4.4);c.strokeStyle='rgba(106,59,9,.2)';c.lineWidth=.32;for(let y=5;y<h;y+=2.6){c.beginPath();c.moveTo(2,y);c.lineTo(w-2,y+.45);c.stroke();}
    }else if(this.skin==='glitter'){
      const g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,'#ddc6ff');g.addColorStop(.37,'#9984d2');g.addColorStop(1,'#4d427c');c.fillStyle=g;c.fillRect(0,0,w,h);
      const time=(this.materialTime||0)/900;
      for(let i=0;i<Math.ceil(w*h/65);i++){
        const hash=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);},x=hash(i+1)*w,y=hash(i+103)*h,phase=hash(i+501)*Math.PI*2,glow=this.reducedMotion?.7:.35+.65*Math.pow((Math.sin(time+phase)+1)/2,5),r=.35+hash(i+51)*.8;
        c.fillStyle=`rgba(${i%3===0?'244,225,255':i%3===1?'205,238,255':'255,248,218'},${glow})`;c.fillRect(x,y,r,r);
        if(i%29===0){const size=1.2+glow*1.3;c.strokeStyle=`rgba(255,250,255,${glow*.8})`;c.lineWidth=.6;c.beginPath();c.moveTo(x-size,y);c.lineTo(x+size,y);c.moveTo(x,y-size);c.lineTo(x,y+size);c.stroke();}
      }
      c.strokeStyle='rgba(242,226,255,.46)';c.lineWidth=1.8;c.strokeRect(2,2,w-4,h-4);
    }else{
      const g=c.createLinearGradient(0,0,w,h*.4);for(const[t,color]of[[0,'#111722'],[.25,'#273444'],[.36,'#788695'],[.42,'#a3adba'],[.48,'#404d5e'],[.74,'#151b27'],[1,'#596979']])g.addColorStop(t,color);c.fillStyle=g;c.fillRect(0,0,w,h);
      c.fillStyle='rgba(146,185,208,.08)';c.beginPath();c.moveTo(w*.12,0);c.lineTo(w*.76,h*.33);c.lineTo(w*.43,h);c.lineTo(0,h*.65);c.closePath();c.fill();
      for(let vein=0;vein<3;vein++){
        c.beginPath();for(let step=0;step<=12;step++){const y=h*step/12,x=w*(.13+vein*.31)+Math.sin(step*.86+vein*2)*w*.09+Math.sin(step*2.1+vein)*w*.023;step?c.lineTo(x,y):c.moveTo(x,y);}c.strokeStyle=vein===1?'rgba(171,187,207,.38)':'rgba(103,139,164,.25)';c.lineWidth=vein===1?.9:.55;c.stroke();
      }
      c.strokeStyle='rgba(183,205,221,.4)';c.lineWidth=1.8;c.strokeRect(2,2,w-4,h-4);
    }
    if(this.skin!=='glass'){c.fillStyle=`rgba(11,19,37,${nz>.5?0:right?.18:.07})`;c.fillRect(0,0,w,h);}
    c.restore();
  }
  drawHint(dir,time){const c=this.ctx,[w,d]=dims(this.state),dx=dir==='right'?1:dir==='left'?-1:0,dy=dir==='down'?1:dir==='up'?-1:0,p=this.project(this.state.x+w/2+dx*(w/2+.8),this.state.y+d/2+dy*(d/2+.8),.1),q=this.project(this.state.x+w/2+dx*(w/2+1.5),this.state.y+d/2+dy*(d/2+1.5),.1);let a=Math.atan2(q.y-p.y,q.x-p.x),pulse=this.reducedMotion?1:.75+.25*Math.sin(time/160);c.save();c.globalAlpha=pulse;c.translate(p.x,p.y);c.rotate(a);c.strokeStyle='#fff3a2';c.lineWidth=3.4;c.lineCap='round';c.lineJoin='round';c.shadowColor='#384b76';c.shadowBlur=5;c.beginPath();c.moveTo(-9,0);c.lineTo(9,0);c.moveTo(2,-6);c.lineTo(9,0);c.lineTo(2,6);c.stroke();c.restore();}
  destroy(){this.destroyed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();}
}
export function paintPreview(canvas,skin='classic',theme='dawn'){const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,pal=THEMES[theme]||THEMES.dawn,g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,pal[0]);g.addColorStop(1,pal[1]);c.fillStyle=g;c.fillRect(0,0,w,h);const r=Object.create(Renderer.prototype);r.canvas=canvas;r.ctx=c;r.skin=SKINS[skin]?skin:'classic';r.camera={scale:w*.24,x:w*.46,y:h*.67};r.drawTile(0,0,false,false,false);r.drawBlock({x:0,y:0,o:0});}


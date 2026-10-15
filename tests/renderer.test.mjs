import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../dist/renderer.js',import.meta.url),'utf8').replaceAll('export ','').replaceAll('import.meta.url',"'file:///renderer.js'");
const {vertices,rotation,rawNext,Renderer,EYE,tileFaces,projectedSurface,fallPlan,fallTransform}=vm.runInNewContext(source+'\n({vertices,rotation,rawNext,Renderer,EYE,tileFaces,projectedSurface,fallPlan,fallTransform})');
const canonical=points=>Array.from(points,p=>Array.from(p,n=>Math.round(n*1e7)/1e7).join(',')).sort().join('|');
for(const o of [0,1,2])for(const dir of ['up','right','down','left']){
  test(`Cuboid orientation ${o} rolls ${dir} to the exact puzzle state`,()=>{
    const state={x:3,y:5,o,mask:0},sign=dir==='right'||dir==='up'?1:-1;
    const transformed=vertices(state).map(rotation(state,dir,sign*Math.PI/2));
    assert.equal(canonical(transformed),canonical(vertices(rawNext(state,dir))));
    for(let step=0;step<=20;step++){
      const points=vertices(state).map(rotation(state,dir,sign*Math.PI/2*step/20));
      assert.ok(points.every(p=>p[2]>-1e-8),'Rolling body must stay above its supporting plane');
      const distance=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
      const original=vertices(state);
      for(let i=0;i<8;i++)for(let j=i+1;j<8;j++)assert.ok(Math.abs(distance(points[i],points[j])-distance(original[i],original[j]))<1e-7,'Rigid rotation must preserve every vertex distance');
    }
  });
}

test('Camera depth follows the actual projection ray',()=>{
  const r=Object.create(Renderer.prototype),p=[2.4,-1.7,.6],q=p.map((n,i)=>n+EYE[i]*3);
  const a=r.projectRaw(...p),b=r.projectRaw(...q);
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-9,'Points on one viewing ray must project to one pixel');
});

// A small vector recorder evaluates the renderer's actual Canvas clipping at
// pixel centres. It needs no browser package, canvas emulator or golden image.
function contains(polygon,x,y){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
class VectorContext {
  constructor(){this.clips=[];this.stack=[];this.ink=[];this.fillStyle='';}
  beginPath(){this.paths=[];this.current=null;}
  moveTo(x,y){this.current=[[x,y]];this.paths.push(this.current);}
  lineTo(x,y){this.current.push([x,y]);}
  closePath(){}
  rect(x,y,w,h){this.moveTo(x,y);this.lineTo(x+w,y);this.lineTo(x+w,y+h);this.lineTo(x,y+h);}
  save(){this.stack.push([...this.clips]);}
  restore(){this.clips=this.stack.pop();}
  clip(rule){const paths=this.paths.map(p=>p.map(q=>[...q]));this.clips.push((x,y)=>rule==='evenodd'?paths.reduce((n,p)=>n+Number(contains(p,x,y)),0)%2===1:paths.some(p=>contains(p,x,y)));}
  fill(){const paths=this.paths.map(p=>p.map(q=>[...q])),clips=[...this.clips];this.ink.push((x,y)=>clips.every(c=>c(x,y))&&paths.some(p=>contains(p,x,y)));}
  stroke(){}
  at(x,y){return this.ink.some(p=>p(x,y));}
}
function scene(){
  const renderer=Object.create(Renderer.prototype);renderer.ctx=new VectorContext();renderer.camera={scale:32,x:160,y:240};renderer.width=420;renderer.height=780;renderer.skin='classic';renderer.textures={};return renderer;
}
function countInk(renderer,predicate=()=>true){let count=0;for(let y=100;y<550;y++)for(let x=30;x<370;x++)if(renderer.ctx.at(x+.5,y+.5)&&predicate(x+.5,y+.5))count++;return count;}
function boardOccluders(renderer,tiles,goal=null){return tiles.flatMap(([x,y])=>tileFaces(x,y,!!goal&&x===goal[0]&&y===goal[1]).map(face=>projectedSurface(face,(...p)=>renderer.project(...p))).filter(Boolean));}

test('An opaque falling block behind the platform cannot paint through tile tops or sidewalls',()=>{
  const r=scene(),floor=Array.from({length:25},(_,i)=>[i%5,Math.floor(i/5)]),state={x:1,y:1,o:0},transform=p=>[p[0],p[1],p[2]-2.3];
  r.drawBlock(state,transform);assert.ok(countInk(r)>500,'Control scene must contain a visible opaque block');
  r.ctx=new VectorContext();r.drawBlock(state,transform,boardOccluders(r,floor));
  assert.equal(countInk(r),0,'Every block fragment must be occluded by the nearer platform surface');
});

test('The victory descent disappears through the exact aperture without fading or spilling onto surrounding tiles',()=>{
  const state={x:2,y:2,o:0},goal=[2,2],counts=[];
  for(const descent of [2.05,2.35,2.8,3.5]){
    const r=scene(),aperture=[[2,2],[3,2],[3,3],[2,3]].map(p=>{const q=r.project(...p);return[q.x,q.y];});
    r.drawBlock(state,p=>[p[0],p[1],p[2]-descent],[],goal);
    assert.equal(countInk(r,(x,y)=>!contains(aperture,x,y)),0,'All geometry below the surface must stay within the projected hole');
    counts.push(countInk(r));
  }
  assert.ok(counts[0]>counts[1]&&counts[1]>counts[2]&&counts[2]>counts[3],'Visible solid area must shrink as the top descends');
  assert.equal(counts[3],0,'The block must completely disappear into the hole');
});

for(const [dir,tiles,pivot,tip]of[
  ['right',[[0,0],[1,0]],2,'right'],['left',[[0,0],[-1,0]],-1,'left'],
  ['down',[[0,0],[0,1]],2,'down'],['up',[[0,0],[0,-1]],-1,'up'],
])test(`A partially supported ${dir} fall tips from the last supporting edge`,()=>{
  const plan=fallPlan({tiles,goal:[9,9]},{x:0,y:0,o:0},dir);
  assert.equal(plan.pivot,pivot);assert.equal(plan.dir,tip);
  const start=vertices(plan.to),axes=[1,3,4].map(i=>start[i].map((n,j)=>n-start[0][j]));
  for(let step=0;step<=80;step++){
    const transform=fallTransform(plan,step/80);
    for(let a=0;a<=4;a++)for(let b=0;b<=4;b++)for(let c=0;c<=4;c++){
      const p=transform(start[0].map((n,i)=>n+(axes[0][i]*a+axes[1][i]*b+axes[2][i]*c)/4));
      if(p[2]>=-1e-7||p[2]<=-.23)continue;
      assert.ok(!tiles.some(([x,y])=>p[0]>x+1e-7&&p[0]<x+1-1e-7&&p[1]>y+1e-7&&p[1]<y+1-1e-7),'The rigid block must never penetrate a supporting platform prism');
    }
  }
});

test('A sideways overhang tips toward its missing support, including a toggled bridge',()=>{
  const level={tiles:[[0,0],[1,0],[0,1],[1,1]],goal:[9,9],switches:[{at:[0,1],bit:0}],bridges:[{at:[1,1],bit:0}]};
  const plan=fallPlan(level,{x:0,y:0,o:1,mask:1},'down');
  assert.equal(plan.to.mask,0);assert.equal(plan.dir,'right');assert.equal(plan.pivot,1);
});

test('A fragile tile breaks under an upright landing before the block falls straight through',()=>{
  const level={tiles:[[0,0],[1,0],[2,0]],fragile:[[2,0]],goal:[9,9]},plan=fallPlan(level,{x:0,y:0,o:1},'right');
  // This move lands at x=2. A broken tile cannot remain as an opaque occluder.
  assert.equal(plan.collapse,true);assert.equal(Array.from(plan.broken).join(';'),'2,0');
  const p=fallTransform(plan,.5)([2.5,.5,1]);assert.equal(p[0],2.5);assert.equal(p[1],.5);assert.ok(p[2]<0);
});

import { LEVELS, move, occupied, isWin, solve } from './levels.js';
import { Renderer } from './renderer.js';
import { loadSave, saveSave, exportSave, parseSave, chooseSave, setSaveScope } from './storage.js';
import { audio } from './audio.js';
import { platform } from './vk-platform.js?v=20261016-overlay';

const $=s=>document.querySelector(s), app=$('#app'), modalRoot=$('#modal-root'), renderer=new Renderer($('#scene'));
const CHAPTERS=['Первые шаги','Обходной путь','Тонкий лёд','Связь берегов','Двойной расчёт','Большой маршрут'];
const SKINS=[{id:'classic',name:'Классика',price:0},{id:'mint',name:'Керамика',price:120},{id:'coral',name:'Коралл',price:240},{id:'lilac',name:'Лаванда',price:360},{id:'midnight',name:'Космос',price:480},{id:'honey',name:'Янтарь',price:600}];
const THEMES=[{id:'dawn',name:'Глубина',price:0,top:'#718dc7',bottom:'#344a7c'},{id:'dusk',name:'Сумерки',price:180,top:'#7b6ca5',bottom:'#3d365d'},{id:'lagoon',name:'Лагуна',price:260,top:'#63aaa8',bottom:'#245964'},{id:'rose',name:'Рассвет',price:340,top:'#c48d9e',bottom:'#754b71'},{id:'night',name:'Полночь',price:420,top:'#354667',bottom:'#142339'},{id:'sand',name:'Песок',price:500,top:'#d7b58e',bottom:'#8e6f62'}];
const RULES=[['Перекатывай блок','На телефоне — свайпами. На компьютере — стрелками. Стоя блок занимает одну клетку, лёжа — две.'],['Попади в отверстие','Финиш засчитывается, когда блок стоит над отверстием вертикально.'],['Хрупкие плитки','Плитка с трещиной выдержит блок только лёжа. Появляется с уровня 41.'],['Кнопки и мосты','Каждый заход на кнопку переключает её мост. Одинаковые точки обозначают пару.'],['Исправляй и пробуй','Отменяй ходы и используй подсказки. Три звезды — за кратчайшее решение.']];
const HERO={tiles:[[3,0],[4,0],[5,0],[2,1],[3,1],[4,1],[5,1],[2,2],[3,2],[4,2],[5,2],[0,3],[1,3],[2,3],[0,4],[1,4],[0,5],[0,6],[1,6],[2,6],[0,7],[1,7],[2,7],[0,8],[1,8],[2,8]],start:{x:0,y:4,o:0,mask:0},goal:[4,1]};
const DIR_TEXT={up:'Назад вправо',right:'Вперёд вправо',down:'Вперёд влево',left:'Назад влево'};
const ICONS=['pause','restart','undo','hint','levels','shop','rules','settings','back','play','star','star-empty'];
const images=new Map(), copy=s=>({x:s.x,y:s.y,o:s.o,mask:s.mask||0});
const same=(a,b)=>a.x===b.x&&a.y===b.y&&a.o===b.o&&(a.mask||0)===(b.mask||0), number=n=>String(n).padStart(2,'0');
const icon=(name,cls='')=>`<img class="ui-icon ${cls}" src="./assets/ui/${name}.webp" alt="" aria-hidden="true" draggable="false">`;
const iconButton=(action,name,label,cls='')=>`<button class="icon-button ${cls}" data-action="${action}" aria-label="${label}" title="${label}">${icon(name)}</button>`;
const starStrip=(count,cls='')=>`<span class="star-strip ${cls}" aria-label="${count} из 3 звёзд">${[1,2,3].map(n=>icon(n<=count?'star':'star-empty',n<=count?'earned':'')).join('')}</span>`;
const coin=()=>'<i class="coin" aria-hidden="true"></i>';
let save=loadSave(),route='home',chapter=0,shopTab='skins',ruleIndex=0,game=null,busy=false,token=0,modal=null,settingsBack='home';
let demoTimer,demoToken=0,previewing=false,toastTimer,platformPaused=false,cloudReady=false;
const completed=()=>Object.keys(save.results).length, starsTotal=()=>Object.values(save.results).reduce((n,r)=>n+r.stars,0);
function persist(){save.updatedAt=Date.now();save.revision=(save.revision||0)+1;save=saveSave(save);if(cloudReady)platform.queueSave(exportSave(save));}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2200);}
function setTheme(id){const t=THEMES.find(t=>t.id===id)||THEMES[0];document.documentElement.style.setProperty('--bg-image',`url('./assets/${t.id}.webp')`);document.documentElement.style.setProperty('--top',t.top);document.documentElement.style.setProperty('--bottom',t.bottom);renderer.setTheme(t.id);$('meta[name=theme-color]').content=t.top;}
function applySettings(){setTheme(save.theme);renderer.setSkin(save.skin);renderer.setReducedMotion(save.settings.reducedMotion);document.body.classList.toggle('no-motion',save.settings.reducedMotion);audio.setSettings(platformPaused?{...save.settings,sound:false,music:false}:save.settings);audio.startMusic();}
function clearDemo(){demoToken++;clearTimeout(demoTimer);renderer.setDemo(false);}
function clearHint(){renderer.setHint(null);$('.hint-message')?.remove();}
function closeModal(){modalRoot.innerHTML='';modal=null;if(previewing){previewing=false;setTheme(save.theme);renderer.setSkin(save.skin);}}
function showModal(type,content){modal=type;modalRoot.innerHTML=`<div class="overlay"><section class="modal modal-${type}" role="dialog" aria-modal="true" aria-label="${type==='win'?'Уровень пройден':type==='pause'?'Пауза':type==='fall'?'Поражение':'Сообщение'}">${content}</section></div>`;queueMicrotask(()=>modalRoot.querySelector('button')?.focus({preventScroll:true}));}
function header(title,right=''){return `<header class="bar">${iconButton('home','back','В главное меню','back-button')}<h1>${title}</h1>${right||'<span class="header-spacer"></span>'}</header>`;}
function coinBadge(){return `<span class="coin-badge">${coin()}${save.coins.toLocaleString('ru-RU')}</span>`;}
function showRoute(next){clearDemo();closeModal();clearHint();token++;busy=false;route=next;$('#scene').style.opacity=['home','game','rules'].includes(next)?'1':'0';render();}
function render(){({home:renderHome,levels:renderLevels,shop:renderShop,settings:renderSettings,game:renderGame,rules:renderRules}[route]||renderHome)();}

function renderHome(){
  const id=save.active?.levelId||save.unlocked;renderer.setMode('home');renderer.setLevel(HERO,HERO.start);renderer.setDemo(true);
  app.innerHTML=`<section class="screen home"><header class="home-top">${iconButton('settings','settings','Настройки')}</header><h1 class="wordmark">КУБОХОД</h1><div class="home-bottom"><button class="primary play-button" data-action="continue" aria-label="${save.active?'Продолжить':'Играть'}, уровень ${id}">${icon('play')}<span>${save.active?'Продолжить':'Играть'}</span><span class="play-level">${number(id)}</span></button><nav class="home-nav">${[['levels','levels','Уровни'],['shop','shop','Магазин'],['rules','rules','Как играть']].map(([a,i,t])=>`<button class="nav-button" data-action="${a}" aria-label="${t}"><span class="nav-art">${icon(i)}</span><span>${t}</span></button>`).join('')}</nav></div></section>`;
}
function renderLevels(){
  const levels=LEVELS.slice(chapter*20,chapter*20+20);
  app.innerHTML=`<section class="screen levels-screen">${header('Уровни',`<span class="star-total">${icon('star')}${starsTotal()}</span>`)}<div class="chapter-bar">${iconButton('chapter-prev','back','Предыдущая глава','chapter-prev')}<div><h2>${CHAPTERS[chapter]}</h2><span>${chapter+1} / 6</span></div>${iconButton('chapter-next','back','Следующая глава','chapter-next')}</div><div class="level-grid">${levels.map(l=>{const r=save.results[l.id],open=l.id<=save.unlocked;return `<button class="level-cell ${r?'done':l.id===save.unlocked?'current':open?'open':'locked'}" data-action="level" data-id="${l.id}" aria-label="Уровень ${l.id}${r?', '+r.stars+' звезды':open?'':', закрыт'}"><span class="level-number">${number(l.id)}</span>${r?starStrip(r.stars):open?'<span class="level-dot"></span>':'<span class="lock" aria-hidden="true"></span>'}</button>`}).join('')}</div><div class="pagination">${CHAPTERS.map((c,i)=>`<button class="page-dot ${i===chapter?'active':''}" data-action="chapter" data-id="${i}" aria-label="Глава ${i+1}"></button>`).join('')}</div></section>`;
  app.querySelector('[data-action=chapter-prev]').disabled=chapter===0;app.querySelector('[data-action=chapter-next]').disabled=chapter===5;
}
function renderShop(){
  const isSkin=shopTab==='skins',items=isSkin?SKINS:THEMES,owned=isSkin?save.ownedSkins:save.ownedThemes,selected=isSkin?save.skin:save.theme;
  app.innerHTML=`<section class="screen shop-screen">${header('Магазин',coinBadge())}<div class="tabs" role="tablist" aria-label="Категория"><button role="tab" aria-selected="${isSkin}" class="tab ${isSkin?'active':''}" data-action="tab" data-id="skins">Облики</button><button role="tab" aria-selected="${!isSkin}" class="tab ${!isSkin?'active':''}" data-action="tab" data-id="themes">Фоны</button></div><div class="shop-scroll"><div class="shop-grid">${items.map(i=>`<button class="shop-card ${selected===i.id?'selected':''}" data-action="shop-item" data-id="${i.id}" aria-label="${i.name}, ${selected===i.id?'выбран':owned.includes(i.id)?'куплен':i.price+' монет'}">${selected===i.id?'<span class="selected-mark" aria-hidden="true"></span>':''}<div class="shop-art ${isSkin?'':'theme-art'}">${isSkin?`<img src="./assets/ui/skin-${i.id}.webp" alt="${i.name}" width="400" height="360" loading="eager" decoding="async" draggable="false">`:`<img src="./assets/${i.id}.webp" alt="${i.name}" loading="eager" decoding="async"><span class="theme-island"></span>`}</div><div class="shop-info"><h2>${i.name}</h2><span class="shop-price">${selected===i.id?'Выбран':owned.includes(i.id)?'Куплен':coin()+i.price}</span></div></button>`).join('')}</div></div></section>`;
}
function previewItem(id){
  const isSkin=shopTab==='skins',i=(isSkin?SKINS:THEMES).find(i=>i.id===id);if(!i)return;const owned=(isSkin?save.ownedSkins:save.ownedThemes).includes(id),selected=(isSkin?save.skin:save.theme)===id;
  previewing=true;if(!isSkin)setTheme(id);else renderer.setSkin(id);
  showModal('shop',`${iconButton('close-modal','back','Закрыть','modal-close')}<div class="item-preview ${isSkin?'':'theme-preview'}"><img src="./assets/${isSkin?'ui/skin-':''}${id}.webp" alt="${i.name}"></div><h2>${i.name}</h2>${owned?`<button class="primary" data-action="equip" data-id="${id}">${selected?'Выбран':'Выбрать'}</button>`:`<button class="primary" data-action="buy" data-id="${id}" ${save.coins<i.price?'disabled':''}>${coin()}${i.price}</button>`}`);
}
function equip(id,buy=false){const isSkin=shopTab==='skins',i=(isSkin?SKINS:THEMES).find(i=>i.id===id),owned=isSkin?save.ownedSkins:save.ownedThemes;if(!i)return;if(buy&&!owned.includes(id)){if(save.coins<i.price)return;save.coins-=i.price;owned.push(id);audio.play('coin');}if(!owned.includes(id))return;if(isSkin)save.skin=id;else save.theme=id;persist();closeModal();applySettings();renderShop();}
function renderSettings(){const rows=[['sound','Звуки'],['music','Музыка'],['haptics','Вибрация'],['reducedMotion','Меньше анимации']];app.innerHTML=`<section class="screen settings-screen">${header('Настройки')}<div class="settings-panel">${rows.map(([id,t])=>`<div class="setting"><h2>${t}</h2><button class="toggle ${save.settings[id]?'on':''}" role="switch" aria-checked="${save.settings[id]}" aria-label="${t}" data-action="toggle" data-id="${id}"><span></span></button></div>`).join('')}</div></section>`;app.querySelector('[data-action=home]').dataset.action='settings-back';}
function renderRules(){renderer.setMode('rules');app.innerHTML=`<section class="screen rules-screen">${header('Как играть')}<div class="rule-content"><h2>${RULES[ruleIndex][0]}</h2><p>${RULES[ruleIndex][1]}</p></div><div class="pagination">${RULES.map((r,i)=>`<button class="page-dot ${i===ruleIndex?'active':''}" data-action="rule" data-id="${i}" aria-label="Правило ${i+1}"></button>`).join('')}</div><div class="rule-buttons">${iconButton('rule-prev','back','Назад')}<button class="primary" data-action="${ruleIndex===4?'rule-play':'rule-next'}">${ruleIndex===4?'Играть':'Дальше'}</button></div></section>`;app.querySelector('[data-action=rule-prev]').disabled=ruleIndex===0;runRuleDemo();}
function runRuleDemo(){
  clearDemo();renderer.setDemo(true);const myToken=demoToken,level=LEVELS[[0,2,40,60,3][ruleIndex]];let state=copy(level.start),index=0;renderer.setLevel(level,state);
  const tick=()=>{if(myToken!==demoToken||route!=='rules')return;if(index>=level.solution.length){renderer.animateWin(()=>{if(myToken!==demoToken)return;demoTimer=setTimeout(()=>{state=copy(level.start);index=0;renderer.setLevel(level,state);demoTimer=setTimeout(tick,700);},900);});return;}const dir=level.solution[index++],next=move(level,state,dir);if(!next)return;if(ruleIndex===4)renderer.setHint(dir);demoTimer=setTimeout(()=>{if(myToken!==demoToken)return;renderer.animateMove(state,next,dir,()=>{state=next;demoTimer=setTimeout(tick,save.settings.reducedMotion?1300:550);});},ruleIndex===4?500:0);};demoTimer=setTimeout(tick,900);
}
function isValidActive(a){if(!a||a.levelId>save.unlocked)return false;const l=LEVELS[a.levelId-1];let s=copy(l.start);if(a.history.length&&!same(a.history[0],s)||a.moves!==a.history.length)return false;for(const n of [...a.history.slice(1),a.state]){if(same(s,n))continue;if(!['up','right','down','left'].some(d=>{const m=move(l,s,d);return m&&same(m,n);}))return false;s=n;}return !isWin(l,a.state)&&occupied(a.state).every(([x,y])=>l.tiles.some(p=>p[0]===x&&p[1]===y));}
function startLevel(id,resume=false){id=Math.max(1,Math.min(120,Number(id)||1));if(id>save.unlocked){toast('Уровень закрыт');return;}const l=LEVELS[id-1],a=resume&&save.active?.levelId===id&&isValidActive(save.active)?save.active:null;game={level:l,state:copy(a?.state||l.start),history:a?a.history.map(copy):[]};saveActive();showRoute('game');audio.play('start');}
function saveActive(){if(!game)return;save.active={levelId:game.level.id,state:copy(game.state),history:game.history.map(copy),moves:game.history.length};persist();}
function renderGame(){if(!game){showRoute('home');return;}const l=game.level;renderer.setMode('game');renderer.setLevel(l,game.state);app.innerHTML=`<section class="screen game"><header class="bar">${iconButton('pause','pause','Пауза')}<h1>Уровень ${number(l.id)}</h1>${iconButton('restart-confirm','restart','Заново')}</header><div class="move-meter" aria-label="Ходы, оптимум ${l.par}"><b id="move-count">${game.history.length}</b><span>/ ${l.par}</span>${icon('star')}</div><div class="game-tools">${iconButton('undo','undo','Отменить ход')}${iconButton('hint','hint','Подсказка')}</div></section>`;updateMoves();}
function updateMoves(){if($('#move-count'))$('#move-count').textContent=game.history.length;const b=app.querySelector('[data-action=undo]');if(b)b.disabled=!game.history.length;}
async function roundBoundary(outcome,t){busy=true;try{await platform.afterRound(outcome);}catch{}return t===token&&route==='game';}
function step(dir){
  if(route!=='game'||!game||busy||modal||platformPaused||platform.isAdOpen)return;clearHint();audio.unlock();const from=copy(game.state),next=move(game.level,from,dir),t=token;busy=true;
  if(!next){audio.play('fail');audio.vibrate([15,30,15]);renderer.animateFall(from,dir,async()=>{if(!await roundBoundary('loss',t))return;busy=false;showModal('fall',`<div class="result-art">${icon('restart')}</div><h2>Ещё раз?</h2><button class="primary" data-action="recover">Продолжить</button><div class="modal-icon-row">${iconButton('restart','restart','Заново')}${iconButton('home','levels','В главное меню')}</div>`);});return;}
  game.history.push(from);game.state=next;if(isWin(game.level,next))game.winResult=recordWin();else saveActive();updateMoves();audio.play('move');audio.vibrate(6);if((from.mask||0)!==(next.mask||0))audio.play('switch');
  renderer.animateMove(from,next,dir,()=>{if(t!==token)return;busy=false;if(isWin(game.level,next)){busy=true;audio.play('win');audio.vibrate([15,50,30]);renderer.animateWin(async()=>{if(await roundBoundary('win',t))win();});}});
}
function undo(){if(route!=='game'||busy||modal||platformPaused||!game?.history.length)return;clearHint();game.state=game.history.pop();renderer.setState(game.state);updateMoves();saveActive();audio.play('undo');}
function restart(){if(game){closeModal();startLevel(game.level.id,false);}}
function pause(){if(route!=='game'||busy||modal)return;showModal('pause',`<h2>Пауза</h2><button class="primary" data-action="close-modal">Продолжить</button><button class="secondary" data-action="home">В главное меню</button><div class="modal-icon-row">${iconButton('restart-confirm','restart','Заново')}${iconButton('settings','settings','Настройки')}</div>`);}
function getHint(){
  if(route!=='game'||busy||modal||platformPaused)return;audio.play('hint');const path=solve(game.level,game.state);
  if(!path){let n=0;for(let i=game.history.length-1;i>=0;i--){if(solve(game.level,game.history[i])){n=game.history.length-i;break;}}showModal('stuck',`<div class="result-art">${icon('undo')}</div><h2>Вернёмся назад?</h2><button class="primary" data-action="rewind" data-id="${n}">${n?'Отменить '+n+' ход.':'Заново'}</button><button class="secondary" data-action="close-modal">Отмена</button>`);return;}
  const d=path[0];if(!d)return;clearHint();renderer.setHint(d);save.hintsUsed++;persist();app.querySelector('.game').insertAdjacentHTML('beforeend',`<div class="hint-message" role="status">${icon('hint')}<span>${DIR_TEXT[d]}</span><button class="close-button" data-action="hide-hint" aria-label="Закрыть подсказку"></button></div>`);
}
function recordWin(){const l=game.level,moves=game.history.length,stars=moves===l.par?3:moves<=l.par+Math.max(3,Math.ceil(l.par*.2))?2:1,prev=save.results[l.id];let reward=(!prev?20:0)+Math.max(0,stars-(prev?.stars||1))*5;const was=LEVELS.filter(v=>v.chapter===l.chapter).every(v=>save.results[v.id]);save.results[l.id]={stars:Math.max(stars,prev?.stars||0),moves,bestMoves:Math.min(moves,prev?.bestMoves??Infinity),completed:true};save.unlocked=Math.max(save.unlocked,Math.min(120,l.id+1));if(!was&&LEVELS.filter(v=>v.chapter===l.chapter).every(v=>save.results[v.id]))reward+=100;save.coins+=reward;save.active=null;persist();return {l,stars,reward,all:completed()===120};}
function win(){busy=false;clearHint();const {l,stars,reward,all}=game.winResult||recordWin();showModal('win',`<h2>${all?'Все 120!':'Уровень '+number(l.id)}</h2>${starStrip(stars,'result-stars')}${reward?`<div class="win-reward">${coin()}+${reward}</div>`:''}<button class="primary" data-action="${all?'all-levels':'next-level'}">${all?'Уровни':'Дальше'}</button><div class="modal-icon-row">${iconButton('restart','restart','Повторить')}${iconButton('levels','levels','К уровням')}</div>`);}

app.addEventListener('click',handleClick);modalRoot.addEventListener('click',handleClick);
function handleClick(e){
  const b=e.target.closest('button[data-action]');if(!b||b.disabled||platformPaused||platform.isAdOpen||(route==='game'&&busy))return;audio.unlock();audio.play('tap');const a=b.dataset.action,id=b.dataset.id;
  switch(a){
    case 'home':showRoute('home');break;
    case 'continue':startLevel(save.active?.levelId||save.unlocked,true);break;
    case 'levels':chapter=game&&route==='game'?game.level.chapter:Math.floor((save.unlocked-1)/20);showRoute('levels');break;
    case 'all-levels':chapter=0;showRoute('levels');break;
    case 'chapter-prev':chapter=Math.max(0,chapter-1);renderLevels();break;
    case 'chapter-next':chapter=Math.min(5,chapter+1);renderLevels();break;
    case 'chapter':chapter=Number(id);renderLevels();break;
    case 'level':startLevel(id,save.active?.levelId===Number(id));break;
    case 'shop':showRoute('shop');break;
    case 'tab':shopTab=id;renderShop();break;
    case 'shop-item':previewItem(id);break;
    case 'equip':equip(id);break;
    case 'buy':equip(id,true);break;
    case 'settings':settingsBack=route;showRoute('settings');break;
    case 'settings-back':showRoute(settingsBack==='game'&&game?'game':'home');break;
    case 'toggle':save.settings[id]=!save.settings[id];persist();applySettings();renderSettings();break;
    case 'rules':ruleIndex=0;showRoute('rules');break;
    case 'rule-next':ruleIndex=Math.min(4,ruleIndex+1);renderRules();break;
    case 'rule-prev':ruleIndex=Math.max(0,ruleIndex-1);renderRules();break;
    case 'rule':ruleIndex=Number(id);renderRules();break;
    case 'rule-play':startLevel(1,false);break;
    case 'undo':undo();break;
    case 'hint':getHint();break;
    case 'hide-hint':clearHint();break;
    case 'pause':pause();break;
    case 'close-modal':closeModal();break;
    case 'recover':closeModal();renderer.setState(game.state);break;
    case 'restart-confirm':if(!busy)showModal('restart',`<h2>Заново?</h2><button class="primary" data-action="restart">Начать заново</button><button class="secondary" data-action="close-modal">Продолжить</button>`);break;
    case 'restart':restart();break;
    case 'next-level':startLevel(Math.min(120,game.level.id+1));break;
    case 'rewind':{const n=Number(id);closeModal();if(!n){restart();break;}for(let i=0;i<n;i++)game.state=game.history.pop();renderer.setState(game.state);updateMoves();saveActive();getHint();break;}
  }
}
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea')||platformPaused||platform.isAdOpen)return;
  if(e.key==='Tab'&&modal){const b=[...modalRoot.querySelectorAll('button:not([disabled])')],i=b.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();b.at(-1)?.focus();}else if(!e.shiftKey&&i===b.length-1){e.preventDefault();b[0]?.focus();}return;}
  if(e.key==='Escape'){e.preventDefault();if(modal&&!['win','fall'].includes(modal))closeModal();else if(!modal&&route==='game')pause();else if(!modal&&route!=='home')showRoute('home');return;}
  if(route!=='game'||modal)return;const dir={ArrowUp:'up',ArrowRight:'right',ArrowDown:'down',ArrowLeft:'left'}[e.key];if(dir){e.preventDefault();step(dir);}else if(['z','Z','я','Backspace'].includes(e.key)){e.preventDefault();undo();}else if(['r','R','к'].includes(e.key)){e.preventDefault();app.querySelector('[data-action=restart-confirm]')?.click();}else if(e.key==='h'||e.key==='р'){e.preventDefault();getHint();}
});
let pointerStart=null;
$('#phone').addEventListener('pointerdown',e=>{audio.unlock();if(route==='game'&&!modal&&!e.target.closest('button'))pointerStart={x:e.clientX,y:e.clientY,id:e.pointerId};});
$('#phone').addEventListener('pointerup',e=>{if(!pointerStart||e.pointerId!==pointerStart.id)return;const dx=e.clientX-pointerStart.x,dy=e.clientY-pointerStart.y;pointerStart=null;if(Math.hypot(dx,dy)<24)return;step(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');});
$('#phone').addEventListener('pointercancel',()=>pointerStart=null);
window.addEventListener('pagehide',()=>{if(game&&route==='game'&&!isWin(game.level,game.state))saveActive();platform.flushSave();});
async function preloadAssets(){const paths=[...ICONS.map(n=>`./assets/ui/${n}.webp`),...SKINS.map(s=>`./assets/ui/skin-${s.id}.webp`),...THEMES.map(t=>`./assets/${t.id}.webp`)];await Promise.allSettled(paths.map(src=>new Promise(resolve=>{const img=new Image();images.set(src,img);img.onload=()=>Promise.resolve().then(()=>img.decode?.()).catch(()=>{}).then(resolve);img.onerror=resolve;img.src=src;})));}
async function initializePlatform(){
  platform.onBannerChange(h=>{document.documentElement.style.setProperty('--vk-banner-height',`${Math.max(0,h)}px`);renderer.resize();});
  platform.onPause(()=>{platformPaused=true;audio.setSettings({...save.settings,sound:false,music:false});});platform.onResume(()=>{platformPaused=false;applySettings();});platform.onAccountChange(()=>{cloudReady=false;location.reload();});
  try{const info=await platform.init();if(info.isVK&&info.userId){setSaveScope(info.userId);save=loadSave();const text=await platform.loadSave();let accepted=true;if(text){try{save=saveSave(chooseSave(save,parseSave(text)));}catch{accepted=false;}}cloudReady=accepted&&platform.cloudReady;if(cloudReady)platform.queueSave(exportSave(save));}}catch{}
}
await Promise.all([preloadAssets(),initializePlatform()]);applySettings();showRoute('home');

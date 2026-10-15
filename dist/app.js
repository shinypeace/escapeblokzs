import { LEVELS, move, occupied, isWin, solve } from './levels.js?v=20261016-200';
import { Renderer } from './renderer.js?v=20261016-200';
import { loadSave, saveSave, exportSave, parseSave, chooseSave, setSaveScope } from './storage.js?v=20261016-200';
import { LEVEL_COUNT, SKINS, THEMES, BOOSTS, consumeBoost, purchaseBoost, purchaseCosmetic, awardRewarded, recordCompletion } from './economy.js';
import { audio } from './audio.js?v=20261016-200';
import { platform } from './vk-platform.js?v=20261016-200';

const $=s=>document.querySelector(s), app=$('#app'), modalRoot=$('#modal-root'), renderer=new Renderer($('#scene'));
const CHAPTERS=['Первые шаги','Обходной путь','Тонкий лёд','Связь берегов','Двойной расчёт','Большой маршрут','Хрупкий баланс','Обратный сигнал','Переплетение','Вершина'];
const RULES=[['Перекатывай блок','На телефоне — свайпами. На компьютере — стрелками. Стоя блок занимает одну клетку, лёжа — две.'],['Попади в отверстие','Финиш засчитывается, когда блок стоит над отверстием вертикально.'],['Хрупкие плитки','Плитка с трещиной выдержит блок только лёжа. Появляется с уровня 41.'],['Кнопки и мосты','Каждый заход на кнопку переключает её мост. Одинаковые точки обозначают пару.'],['Исправляй и пробуй','Отменяй ходы и используй подсказки. Три звезды — за кратчайшее решение.'],['Помощь и секреты','Помощь можно купить в магазине или получить по 3 за видео. Облики и фоны раскрываются после покупки. Три разных повторных прохождения в сутки дают по 40 монет.']];
const HERO={tiles:[[3,0],[4,0],[5,0],[2,1],[3,1],[4,1],[5,1],[2,2],[3,2],[4,2],[5,2],[0,3],[1,3],[2,3],[0,4],[1,4],[0,5],[0,6],[1,6],[2,6],[0,7],[1,7],[2,7],[0,8],[1,8],[2,8]],start:{x:0,y:4,o:0,mask:0},goal:[4,1]};
const DIR_TEXT={up:'Назад вправо',right:'Вперёд вправо',down:'Вперёд влево',left:'Назад влево'};
const ICONS=['pause','restart','undo','hint','levels','shop','rules','settings','back','play','star','star-empty','mystery'];
const images=new Map(), copy=s=>({x:s.x,y:s.y,o:s.o,mask:s.mask||0});
const same=(a,b)=>a.x===b.x&&a.y===b.y&&a.o===b.o&&(a.mask||0)===(b.mask||0), number=n=>String(n).padStart(2,'0');
const icon=(name,cls='')=>`<img class="ui-icon ${cls}" src="./assets/ui/${name}.webp" alt="" aria-hidden="true" draggable="false">`;
const iconButton=(action,name,label,cls='')=>`<button class="icon-button ${cls}" data-action="${action}" aria-label="${label}" title="${label}">${icon(name)}</button>`;
const starStrip=(count,cls='')=>`<span class="star-strip ${cls}" aria-label="${count} из 3 звёзд">${[1,2,3].map(n=>icon(n<=count?'star':'star-empty',n<=count?'earned':'')).join('')}</span>`;
const coin=()=>'<i class="coin" aria-hidden="true"></i>';
const mysteryArt=()=>'<span class="mystery-art" aria-hidden="true"><img src="./assets/ui/mystery.webp" alt="" width="400" height="267" draggable="false"></span>';
let save=loadSave(),route='home',chapter=0,shopTab='skins',ruleIndex=0,game=null,busy=false,token=0,modal=null,settingsBack='home';
let demoTimer,demoToken=0,previewing=false,toastTimer,platformPaused=false,cloudReady=false,rewardPending=false,shopBack='home';
const boostUsedAt={hints:0,undos:0};
const completed=()=>Object.keys(save.results).length, starsTotal=()=>Object.values(save.results).reduce((n,r)=>n+r.stars,0);
function persist(){save.updatedAt=Date.now();save.revision=(save.revision||0)+1;save=saveSave(save);if(cloudReady)platform.queueSave(exportSave(save));}
function toast(text){$('#toast').textContent=text;$('#toast').classList.toggle('above-tools',route==='game');$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2200);}
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
  app.innerHTML=`<section class="screen levels-screen">${header('Уровни',`<span class="star-total">${icon('star')}${starsTotal()}</span>`)}<div class="chapter-bar">${iconButton('chapter-prev','back','Предыдущая глава','chapter-prev')}<div><h2>${CHAPTERS[chapter]}</h2><span>${chapter+1} / ${CHAPTERS.length}</span></div>${iconButton('chapter-next','back','Следующая глава','chapter-next')}</div><div class="level-grid">${levels.map(l=>{const r=save.results[l.id],open=l.id<=save.unlocked;return `<button class="level-cell ${r?'done':l.id===save.unlocked?'current':open?'open':'locked'}" data-action="level" data-id="${l.id}" aria-label="Уровень ${l.id}${r?', '+r.stars+' звезды':open?'':', закрыт'}"><span class="level-number">${number(l.id)}</span>${r?starStrip(r.stars):open?'<span class="level-dot"></span>':'<span class="lock" aria-hidden="true"></span>'}</button>`}).join('')}</div><div class="pagination">${CHAPTERS.map((c,i)=>`<button class="page-dot ${i===chapter?'active':''}" data-action="chapter" data-id="${i}" aria-label="Глава ${i+1}"></button>`).join('')}</div></section>`;
  app.querySelector('[data-action=chapter-prev]').disabled=chapter===0;app.querySelector('[data-action=chapter-next]').disabled=chapter===CHAPTERS.length-1;
}
function renderShop(){
  const isSkin=shopTab==='skins',isBoost=shopTab==='boosts',items=isBoost?BOOSTS:isSkin?SKINS:THEMES,owned=isSkin?save.ownedSkins:save.ownedThemes,selected=isSkin?save.skin:save.theme;
  const tabs=[['skins','Облики'],['themes','Фоны'],['boosts','Помощь']].map(([id,label])=>`<button role="tab" aria-selected="${shopTab===id}" class="tab ${shopTab===id?'active':''}" data-action="tab" data-id="${id}">${label}</button>`).join('');
  const cards=items.map((i,index)=>{
    if(isBoost){const label=i.id==='hints'?'Подсказки':'Отмены';return `<button class="shop-card boost-card" data-action="boost-item" data-id="${i.id}" aria-label="${label}, ${i.quantity} за ${i.price} монет"><div class="shop-art boost-art">${icon(i.id==='hints'?'hint':'undo')}<span class="pack-size">×${i.quantity}</span></div><div class="shop-info"><h2>${label}</h2><span class="boost-stock">В запасе: ${save[i.id]}</span><span class="shop-price">${coin()}${i.price}</span></div></button>`;}
    const known=owned.includes(i.id),label=known?i.name:`Секрет №${index}`,art=known?(isSkin?`<img src="./assets/ui/skin-${i.id}.webp?v=20261016-200" alt="${i.name}" width="400" height="360" loading="eager" decoding="async" draggable="false">`:`<img src="./assets/${i.id}.webp" alt="${i.name}" loading="eager" decoding="async"><span class="theme-island"></span>`):mysteryArt();
    return `<button class="shop-card ${selected===i.id?'selected':''} ${known?'':'secret-card'}" data-action="shop-item" data-id="${i.id}" aria-label="${label}, ${selected===i.id?'выбран':known?'открыт':i.price+' монет'}">${selected===i.id?'<span class="selected-mark" aria-hidden="true"></span>':''}<div class="shop-art ${isSkin?'':'theme-art'}">${art}</div><div class="shop-info"><h2>${label}</h2><span class="shop-price">${selected===i.id?'Выбран':known?'Открыт':coin()+i.price}</span></div></button>`;
  }).join('');
  app.innerHTML=`<section class="screen shop-screen">${header('Магазин',coinBadge())}<div class="tabs" role="tablist" aria-label="Категория">${tabs}</div><div class="shop-scroll"><div class="shop-grid">${cards}</div></div></section>`;
  app.querySelector('[data-action=home]').dataset.action='shop-back';
}
function previewItem(id){
  const isSkin=shopTab==='skins',i=(isSkin?SKINS:THEMES).find(i=>i.id===id);if(!i)return;const owned=(isSkin?save.ownedSkins:save.ownedThemes).includes(id),selected=(isSkin?save.skin:save.theme)===id;
  if(!owned){showModal('shop',`${iconButton('close-modal','back','Закрыть','modal-close')}<div class="item-preview">${mysteryArt()}</div><h2>Секретный ${isSkin?'облик':'фон'}</h2><button class="primary" data-action="buy" data-id="${id}" ${save.coins<i.price?'disabled':''}>Открыть ${coin()}${i.price}</button>`);return;}
  previewing=true;if(!isSkin)setTheme(id);else renderer.setSkin(id);
  showModal('shop',`${iconButton('close-modal','back','Закрыть','modal-close')}<div class="item-preview ${isSkin?'':'theme-preview'}"><img src="./assets/${isSkin?'ui/skin-':''}${id}.webp?v=20261016-200" alt="${i.name}"></div><h2>${i.name}</h2><button class="primary" data-action="equip" data-id="${id}">${selected?'Выбран':'Выбрать'}</button>`);
}
function equip(id,buy=false){const isSkin=shopTab==='skins',i=(isSkin?SKINS:THEMES).find(i=>i.id===id),owned=isSkin?save.ownedSkins:save.ownedThemes;if(!i)return;if(buy&&!owned.includes(id)){const result=purchaseCosmetic(save,shopTab,id);if(!result.ok)return;audio.play('coin');}if(!owned.includes(id))return;if(isSkin)save.skin=id;else save.theme=id;persist();closeModal();applySettings();renderShop();if(buy){audio.play('reveal');previewItem(id);}}
function previewBoost(id){const i=BOOSTS.find(b=>b.id===id);if(!i)return;const label=id==='hints'?'Подсказки':'Отмены';showModal('boost',`${iconButton('close-modal','back','Закрыть','modal-close')}<div class="result-art">${icon(id==='hints'?'hint':'undo')}</div><h2>${label} ×${i.quantity}</h2><button class="primary" data-action="buy-boost" data-id="${id}" ${save.coins<i.price?'disabled':''}>${coin()}${i.price}</button>`);}
function buyBoost(id){const result=purchaseBoost(save,id);if(!result.ok)return;persist();audio.play('coin');closeModal();renderShop();}
function boostButton(kind){const name=kind==='hints'?'hint':'undo',label=kind==='hints'?'Подсказка':'Отменить ход',count=save[kind];return `<button class="icon-button boost-button ${count?'':'needs-ad'}" data-action="${name}" aria-label="${count?label+', осталось '+count:'Видео: +3 '+(kind==='hints'?'подсказки':'отмены')}" title="${label}">${icon(name)}<span class="boost-badge ${count?'':'ad-badge'}">${count||'AD +3'}</span></button>`;}
function updateBoostButtons(){const tools=app.querySelector('.game-tools');if(tools)tools.innerHTML=boostButton('undos')+boostButton('hints');const undoButton=app.querySelector('[data-action=undo]');if(undoButton)undoButton.disabled=save.undos>0&&!game?.history.length;}
function showEmptyBoost(kind,reason=''){const label=kind==='hints'?'Подсказки':'Отмены',video=platform.isVK&&!reason,message=reason||(!platform.isVK?'Видео доступно внутри VK':'');showModal('boost',`${iconButton('close-modal','back','Закрыть','modal-close')}<div class="result-art">${icon(kind==='hints'?'hint':'undo')}</div><h2>${label} закончились</h2>${message?`<p class="boost-status">${message}</p>`:''}${video?`<button class="primary" data-action="watch-boost" data-id="${kind}">Видео · +3</button>`:''}<button class="${video?'secondary':'primary'}" data-action="boost-shop">В магазин</button>`);}
async function requestBoostVideo(kind){
  if(rewardPending||save[kind]>0||platformPaused||platform.isAdOpen||Date.now()-boostUsedAt[kind]<400)return;
  if(!platform.isVK){showEmptyBoost(kind,'Видео доступно внутри VK');return;}
  rewardPending=true;busy=true;const account=platform.userId;
  try{const result=await platform.rewarded(kind);if(result.ok&&platform.userId===account){const reward=awardRewarded(save,kind,result.receiptId);if(reward.ok){persist();audio.play('reward');toast(kind==='hints'?'+3 подсказки':'+3 отмены');}}else if(result.reason!=='cancelled'){showEmptyBoost(kind,'Сейчас нет доступного видео');}}
  catch{showEmptyBoost(kind,'Не удалось загрузить видео');}
  finally{rewardPending=false;busy=false;updateBoostButtons();}
}
function renderSettings(){const rows=[['sound','Звуки'],['music','Музыка'],['haptics','Вибрация'],['reducedMotion','Меньше анимации']];app.innerHTML=`<section class="screen settings-screen">${header('Настройки')}<div class="settings-panel">${rows.map(([id,t])=>`<div class="setting"><h2>${t}</h2><button class="toggle ${save.settings[id]?'on':''}" role="switch" aria-checked="${save.settings[id]}" aria-label="${t}" data-action="toggle" data-id="${id}"><span></span></button></div>`).join('')}</div></section>`;app.querySelector('[data-action=home]').dataset.action='settings-back';}
function renderRules(){renderer.setMode('rules');const last=ruleIndex===RULES.length-1;app.innerHTML=`<section class="screen rules-screen">${header('Как играть')}<div class="rule-content"><h2>${RULES[ruleIndex][0]}</h2><p>${RULES[ruleIndex][1]}</p></div><div class="pagination">${RULES.map((r,i)=>`<button class="page-dot ${i===ruleIndex?'active':''}" data-action="rule" data-id="${i}" aria-label="Правило ${i+1}"></button>`).join('')}</div><div class="rule-buttons">${iconButton('rule-prev','back','Назад')}<button class="primary" data-action="${last?'rule-play':'rule-next'}">${last?'Играть':'Дальше'}</button></div></section>`;app.querySelector('[data-action=rule-prev]').disabled=ruleIndex===0;runRuleDemo();}
function runRuleDemo(){
  clearDemo();renderer.setDemo(true);const myToken=demoToken,level=LEVELS[[0,2,40,60,3,3][ruleIndex]];let state=copy(level.start),index=0;renderer.setLevel(level,state);
  const tick=()=>{if(myToken!==demoToken||route!=='rules')return;if(index>=level.solution.length){renderer.animateWin(()=>{if(myToken!==demoToken)return;demoTimer=setTimeout(()=>{state=copy(level.start);index=0;renderer.setLevel(level,state);demoTimer=setTimeout(tick,700);},900);});return;}const dir=level.solution[index++],next=move(level,state,dir);if(!next)return;if(ruleIndex===4)renderer.setHint(dir);demoTimer=setTimeout(()=>{if(myToken!==demoToken)return;renderer.animateMove(state,next,dir,()=>{state=next;demoTimer=setTimeout(tick,save.settings.reducedMotion?1300:550);});},ruleIndex===4?500:0);};demoTimer=setTimeout(tick,900);
}
function isValidActive(a){if(!a||a.levelId>save.unlocked)return false;const l=LEVELS[a.levelId-1];let s=copy(l.start);if(a.history.length&&!same(a.history[0],s)||a.moves!==a.history.length)return false;for(const n of [...a.history.slice(1),a.state]){if(same(s,n))continue;if(!['up','right','down','left'].some(d=>{const m=move(l,s,d);return m&&same(m,n);}))return false;s=n;}return !isWin(l,a.state)&&occupied(a.state).every(([x,y])=>l.tiles.some(p=>p[0]===x&&p[1]===y));}
function startLevel(id,resume=false){id=Math.max(1,Math.min(LEVEL_COUNT,Number(id)||1));if(id>save.unlocked){toast('Уровень закрыт');return;}const l=LEVELS[id-1],a=resume&&save.active?.levelId===id&&isValidActive(save.active)?save.active:null;game={level:l,state:copy(a?.state||l.start),history:a?a.history.map(copy):[]};saveActive();showRoute('game');audio.play('start');}
function saveActive(){if(!game)return;save.active={levelId:game.level.id,state:copy(game.state),history:game.history.map(copy),moves:game.history.length};persist();}
function renderGame(){if(!game){showRoute('home');return;}const l=game.level;renderer.setMode('game');renderer.setLevel(l,game.state);app.innerHTML=`<section class="screen game"><header class="bar">${iconButton('pause','pause','Пауза')}<h1>Уровень ${number(l.id)}</h1>${iconButton('restart-confirm','restart','Заново')}</header><div class="move-meter" aria-label="Ходы, оптимум ${l.par}"><b id="move-count">${game.history.length}</b><span>/ ${l.par}</span>${icon('star')}</div><div class="game-tools"></div></section>`;updateMoves();}
function updateMoves(){if($('#move-count'))$('#move-count').textContent=game.history.length;updateBoostButtons();}
async function roundBoundary(outcome,t){busy=true;try{await platform.afterRound(outcome);}catch{}return t===token&&route==='game';}
function step(dir){
  if(route!=='game'||!game||busy||modal||platformPaused||platform.isAdOpen)return;clearHint();audio.unlock();const from=copy(game.state),next=move(game.level,from,dir),t=token;busy=true;
  if(!next){const attempted=game.level.fragile?.length?move({...game.level,fragile:[]},from,dir):null;audio.play(attempted&&attempted.o===0&&game.level.fragile.some(([x,y])=>x===attempted.x&&y===attempted.y)?'glass':'fail');audio.vibrate([15,30,15]);renderer.animateFall(from,dir,async()=>{if(!await roundBoundary('loss',t))return;busy=false;showModal('fall',`<div class="result-art">${icon('restart')}</div><h2>Ещё раз?</h2><button class="primary" data-action="recover">Продолжить</button><div class="modal-icon-row">${iconButton('restart','restart','Заново')}${iconButton('home','levels','В главное меню')}</div>`);});return;}
  game.history.push(from);game.state=next;if(isWin(game.level,next))game.winResult=recordWin();else saveActive();updateMoves();audio.play('move');audio.vibrate(6);if((from.mask||0)!==(next.mask||0))audio.play('switch');
  renderer.animateMove(from,next,dir,()=>{if(t!==token)return;busy=false;if(isWin(game.level,next)){busy=true;audio.play('portal');audio.vibrate([15,50,30]);renderer.animateWin(async()=>{if(await roundBoundary('win',t))win();});}});
}
function undo(direct=true){if(route!=='game'||busy||modal||platformPaused)return;if(!save.undos){if(direct)void requestBoostVideo('undos');else showEmptyBoost('undos');return;}if(!game?.history.length||!consumeBoost(save,'undos').ok)return;boostUsedAt.undos=Date.now();clearHint();game.state=game.history.pop();renderer.setState(game.state);updateMoves();saveActive();audio.play('undo');}
function restart(){if(game){closeModal();startLevel(game.level.id,false);}}
function pause(){if(route!=='game'||busy||modal)return;showModal('pause',`<h2>Пауза</h2><button class="primary" data-action="close-modal">Продолжить</button><button class="secondary" data-action="home">В главное меню</button><div class="modal-icon-row">${iconButton('restart-confirm','restart','Заново')}${iconButton('settings','settings','Настройки')}</div>`);}
function getHint(direct=true){
  if(route!=='game'||busy||modal||platformPaused)return;if(!save.hints){if(direct)void requestBoostVideo('hints');else showEmptyBoost('hints');return;}if($('.hint-message'))return;const path=solve(game.level,game.state);
  if(!path){let n=0;for(let i=game.history.length-1;i>=0;i--){if(solve(game.level,game.history[i])){n=game.history.length-i;break;}}showModal('stuck',`<div class="result-art">${icon('undo')}</div><h2>Вернёмся назад?</h2>${n&&save.undos>=n?`<button class="primary" data-action="rewind" data-id="${n}">Назад · ${n} отмены</button>`:''}<button class="${n&&save.undos>=n?'secondary':'primary'}" data-action="restart">Заново</button><div class="modal-icon-row">${iconButton('close-modal','back','Продолжить')}</div>`);return;}
  const d=path[0];if(!d||!consumeBoost(save,'hints').ok)return;boostUsedAt.hints=Date.now();audio.play('hint');clearHint();renderer.setHint(d);save.hintsUsed++;persist();updateBoostButtons();app.querySelector('.game').insertAdjacentHTML('beforeend',`<div class="hint-message" role="status">${icon('hint')}<span>${DIR_TEXT[d]}</span><button class="close-button" data-action="hide-hint" aria-label="Закрыть подсказку"></button></div>`);
}
function recordWin(){const l=game.level,moves=game.history.length,stars=moves===l.par?3:moves<=l.par+Math.max(3,Math.ceil(l.par*.2))?2:1;const result=recordCompletion(save,{levelId:l.id,stars,moves,date:new Date()});persist();return {l,stars,reward:result.reward||0,all:completed()===LEVEL_COUNT};}
function win(){busy=false;clearHint();audio.play('win');const {l,stars,reward,all}=game.winResult||recordWin();showModal('win',`<h2>${all?'Все '+LEVEL_COUNT+'!':'Уровень '+number(l.id)}</h2>${starStrip(stars,'result-stars')}${reward?`<div class="win-reward">${coin()}+${reward}</div>`:''}<button class="primary" data-action="${all?'all-levels':'next-level'}">${all?'Уровни':'Дальше'}</button><div class="modal-icon-row">${iconButton('restart','restart','Повторить')}${iconButton('levels','levels','К уровням')}</div>`);}

app.addEventListener('click',handleClick);modalRoot.addEventListener('click',handleClick);
function handleClick(e){
  const b=e.target.closest('button[data-action]');if(!b||b.disabled||platformPaused||platform.isAdOpen||(route==='game'&&busy))return;audio.unlock();audio.play('tap');const a=b.dataset.action,id=b.dataset.id;
  switch(a){
    case 'home':showRoute('home');break;
    case 'continue':startLevel(save.active?.levelId||save.unlocked,true);break;
    case 'levels':chapter=game&&route==='game'?game.level.chapter:Math.floor((save.unlocked-1)/20);showRoute('levels');break;
    case 'all-levels':chapter=0;showRoute('levels');break;
    case 'chapter-prev':chapter=Math.max(0,chapter-1);renderLevels();break;
    case 'chapter-next':chapter=Math.min(CHAPTERS.length-1,chapter+1);renderLevels();break;
    case 'chapter':chapter=Number(id);renderLevels();break;
    case 'level':startLevel(id,save.active?.levelId===Number(id));break;
    case 'shop':shopBack='home';showRoute('shop');break;
    case 'shop-back':showRoute(shopBack==='game'&&game?'game':'home');break;
    case 'tab':shopTab=id;renderShop();break;
    case 'shop-item':previewItem(id);break;
    case 'equip':equip(id);break;
    case 'buy':equip(id,true);break;
    case 'boost-item':previewBoost(id);break;
    case 'buy-boost':buyBoost(id);break;
    case 'boost-shop':shopBack=route==='game'?'game':'home';shopTab='boosts';showRoute('shop');break;
    case 'watch-boost':closeModal();void requestBoostVideo(id);break;
    case 'settings':settingsBack=route;showRoute('settings');break;
    case 'settings-back':showRoute(settingsBack==='game'&&game?'game':'home');break;
    case 'toggle':save.settings[id]=!save.settings[id];persist();applySettings();renderSettings();break;
    case 'rules':ruleIndex=0;showRoute('rules');break;
    case 'rule-next':ruleIndex=Math.min(RULES.length-1,ruleIndex+1);renderRules();break;
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
    case 'next-level':startLevel(Math.min(LEVEL_COUNT,game.level.id+1));break;
    case 'rewind':{const n=Number(id);if(!n||n>game.history.length||!consumeBoost(save,'undos',n).ok)break;closeModal();for(let i=0;i<n;i++)game.state=game.history.pop();renderer.setState(game.state);updateMoves();saveActive();audio.play('undo');break;}
  }
}
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea')||platformPaused||platform.isAdOpen)return;
  if(e.key==='Tab'&&modal){const b=[...modalRoot.querySelectorAll('button:not([disabled])')],i=b.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();b.at(-1)?.focus();}else if(!e.shiftKey&&i===b.length-1){e.preventDefault();b[0]?.focus();}return;}
  if(e.key==='Escape'){e.preventDefault();if(modal&&!['win','fall'].includes(modal))closeModal();else if(!modal&&route==='game')pause();else if(!modal&&route!=='home')showRoute('home');return;}
  if(route!=='game'||modal)return;const dir={ArrowUp:'up',ArrowRight:'right',ArrowDown:'down',ArrowLeft:'left'}[e.key];if(dir){e.preventDefault();step(dir);}else if(['z','Z','я','Backspace'].includes(e.key)){e.preventDefault();undo(false);}else if(['r','R','к'].includes(e.key)){e.preventDefault();app.querySelector('[data-action=restart-confirm]')?.click();}else if(e.key==='h'||e.key==='р'){e.preventDefault();getHint(false);}
});
let pointerStart=null;
$('#phone').addEventListener('pointerdown',e=>{audio.unlock();if(route==='game'&&!modal&&!e.target.closest('button'))pointerStart={x:e.clientX,y:e.clientY,id:e.pointerId};});
$('#phone').addEventListener('pointerup',e=>{if(!pointerStart||e.pointerId!==pointerStart.id)return;const dx=e.clientX-pointerStart.x,dy=e.clientY-pointerStart.y;pointerStart=null;if(Math.hypot(dx,dy)<24)return;step(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');});
$('#phone').addEventListener('pointercancel',()=>pointerStart=null);
window.addEventListener('pagehide',()=>{if(game&&route==='game'&&!isWin(game.level,game.state))saveActive();platform.flushSave();});
async function preloadAssets(){const paths=[...ICONS.map(n=>`./assets/ui/${n}.webp`),...SKINS.map(s=>`./assets/ui/skin-${s.id}.webp?v=20261016-200`),...THEMES.map(t=>`./assets/${t.id}.webp`)];await Promise.allSettled(paths.map(src=>new Promise(resolve=>{const img=new Image();images.set(src,img);img.onload=()=>Promise.resolve().then(()=>img.decode?.()).catch(()=>{}).then(resolve);img.onerror=resolve;img.src=src;})));void audio.preload?.();}
async function initializePlatform(){
  platform.onBannerChange(h=>{document.documentElement.style.setProperty('--vk-banner-height',`${Math.max(0,h)}px`);renderer.resize();});
  platform.onPause(()=>{platformPaused=true;audio.setSettings({...save.settings,sound:false,music:false});});platform.onResume(()=>{platformPaused=false;applySettings();});platform.onAccountChange(()=>{cloudReady=false;location.reload();});
  try{const info=await platform.init();if(info.isVK&&info.userId){setSaveScope(info.userId);save=loadSave();const text=await platform.loadSave();let accepted=true;if(text){try{save=saveSave(chooseSave(save,parseSave(text)));}catch{accepted=false;}}cloudReady=accepted&&platform.cloudReady;if(cloudReady)platform.queueSave(exportSave(save));}}catch{}
}
await Promise.all([preloadAssets(),initializePlatform()]);applySettings();showRoute('home');

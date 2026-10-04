const KIOSK_BASE_URL='https://doner-club-kiosk.onrender.com';
const STOP_REFRESH_MS=30*1000;
const CART_KEY='donerclub-site-cart-v1';
const PROFILE_KEY='donerclub-site-profile-v1';
const FULFILLMENT_KEY='donerclub-site-fulfillment-v1';

let categories=[],products=[],cart=[],selectedProduct=null,stoppedProductIds={},stopRefreshTimer=null,fulfillment={mode:'pickup',value:'Арай, 1А'},profile=null,comment='',promo='';
let menuVersion=0,menuReady=false,categoryObserver=null,noticeTimer=null;

const $=s=>document.querySelector(s);
const money=v=>Math.round(Number(v||0)).toLocaleString('ru-RU')+' ₸';
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const categoryName=c=>c&&c.name?c.name:'Раздел';

function currentPointConfig(){
  const value=String(fulfillment&&fulfillment.value||'').toLowerCase();
  if(fulfillment&&fulfillment.mode==='pickup'&&value.includes('республика')){
    return {key:'RESPUBLIKA',label:'Республика',menu:'Kiosk Республика'};
  }
  return {key:'Arai',label:'Арай',menu:'Kiosk Арай'};
}
function kioskMenuUrl(){
  const point=currentPointConfig();
  return KIOSK_BASE_URL+'/kiosk-menu?point='+encodeURIComponent(point.key)+'&menu='+encodeURIComponent(point.menu);
}
function kioskStopUrl(){
  const point=currentPointConfig();
  return KIOSK_BASE_URL+'/kiosk-stop-list?point='+encodeURIComponent(point.key);
}

function loadState(){
  try{cart=JSON.parse(localStorage.getItem(CART_KEY)||'[]')||[]}catch(e){cart=[]}
  try{profile=JSON.parse(localStorage.getItem(PROFILE_KEY)||'null')}catch(e){profile=null}
  try{fulfillment=JSON.parse(localStorage.getItem(FULFILLMENT_KEY)||'null')||fulfillment}catch(e){}
  if(fulfillment.mode!=='pickup'){fulfillment={mode:'pickup',value:'Арай, 1А'};cart=[];saveCart();saveFulfillment()}
  updateProfileUI(); updateFulfillmentUI(); updateCart();
}
function saveCart(){localStorage.setItem(CART_KEY,JSON.stringify(cart))}
function saveFulfillment(){localStorage.setItem(FULFILLMENT_KEY,JSON.stringify(fulfillment))}
function total(){return cart.reduce((s,x)=>s+(Number(x.unitPrice)||0)*(Number(x.q)||0),0)}
function cartCount(){return cart.reduce((s,x)=>s+(Number(x.q)||0),0)}
function isStoppedProductId(id){return !!stoppedProductIds[String(id||'').toLowerCase()]}
function isOrderTypeGroup(g){
  const n=String(g&&g.name||'').toLowerCase();
  return n.includes('тип заказа')||n.includes('формат заказа');
}
function availableModifierItems(g){return (g&&g.items||[]).filter(m=>!isStoppedProductId(m&&m.id))}
function productIsAvailable(p){
  if(!p||isStoppedProductId(p.itemId))return false;
  return (p.modifierGroups||[]).every(g=>isOrderTypeGroup(g)||availableModifierItems(g).length>=(Number(g.minQuantity)||0));
}
function visibleGroups(p){
  return (p&&p.modifierGroups||[]).filter(g=>!isOrderTypeGroup(g)&&availableModifierItems(g).length).map(g=>({...g,items:availableModifierItems(g)}));
}
function visibleCategories(){
  return categories.filter(c=>products.some(p=>p.categoryId===c.id&&productIsAvailable(p)));
}
function hasModifiers(p){return visibleGroups(p).some(g=>(g.items||[]).length)}
function productQty(id){return cart.filter(x=>x.productId===id).reduce((s,x)=>s+x.q,0)}

async function loadMenu(){
  const status=$('#menuStatus');
  const version=++menuVersion;
  menuReady=false;
  if(stopRefreshTimer)clearTimeout(stopRefreshTimer);
  categories=[];products=[];paintCategories();updateCart();
  status.hidden=false;status.textContent='Загружаем меню…';
  $('#menuRoot').innerHTML='<div class="menuLoading"><div class="spinner"></div><b>Загружаем меню выбранной точки</b></div>';
  try{
    const [data,stop]=await Promise.all([fetchMenuData(kioskMenuUrl()),fetchMenuData(kioskStopUrl())]);
    if(version!==menuVersion)return;
    categories=data.categories||[];
    products=data.products||[];
    menuReady=true;
    applyStopList(stop);
    status.textContent='';status.hidden=true;
    paintCategories();
    paintMenu();
    updateCart();
  }catch(e){
    if(version!==menuVersion)return;
    status.textContent='Меню временно недоступно';
    $('#menuRoot').innerHTML='<div class="menuError"><b>Не удалось загрузить меню</b><span>Проверьте соединение и попробуйте ещё раз</span><button class="heroAction" id="retryMenu" type="button" style="margin-top:16px">Повторить</button></div>';
    $('#retryMenu').onclick=loadMenu;
  }finally{
    if(version===menuVersion&&menuReady)scheduleStopRefresh();
  }
}
async function fetchMenuData(url){
  const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(25000)});
  const data=await r.json();
  if(!r.ok||!data.success)throw new Error('Menu unavailable');
  return data;
}

function sameStopMap(a,b){
  const ak=Object.keys(a||{}).sort(),bk=Object.keys(b||{}).sort();
  return ak.length===bk.length&&ak.every((v,i)=>v===bk[i]);
}
function removeStoppedFromCart(){
  const before=cart.length;
  cart=cart.filter(line=>{
    let itemId=line.itemId;
    if(!itemId){
      const product=products.find(p=>p.id===line.productId);
      itemId=product&&product.itemId;
    }
    const product=products.find(p=>p.id===line.productId);
    if(!product||!productIsAvailable(product)||isStoppedProductId(itemId))return false;
    return !(line.modifierIds||[]).some(isStoppedProductId);
  });
  if(cart.length!==before){saveCart();updateCart();refreshCardActions();notifyCart('Некоторые блюда или добавки закончились — мы убрали их из корзины.');return true}
  return false;
}
function applyStopList(data){
  const next={};
  (data&&data.stoppedProductIds||[]).forEach(id=>next[String(id).toLowerCase()]=true);
  const changed=!sameStopMap(stoppedProductIds,next);
  stoppedProductIds=next;
  const cartChanged=removeStoppedFromCart();

  if(selectedProduct&&!productIsAvailable(selectedProduct))closeModal();
  else if(changed&&$('#modalRoot .productModal')){closeModal();if(!cartChanged)notifyCart('Наличие обновилось. Откройте блюдо, чтобы выбрать доступные добавки.')}

  if(changed||cartChanged){
    paintCategories();
    paintMenu();
    updateCart();
  }
}
function scheduleStopRefresh(){
  if(stopRefreshTimer)clearTimeout(stopRefreshTimer);
  stopRefreshTimer=setTimeout(loadStopList,STOP_REFRESH_MS);
}
async function loadStopList(){
  const version=menuVersion;
  try{
    const data=await fetchMenuData(kioskStopUrl());
    if(version!==menuVersion||!menuReady)return;
    applyStopList(data);
  }catch(e){
    // Keep last known stop list; retry in 30 seconds.
  }finally{
    if(version===menuVersion&&menuReady)scheduleStopRefresh();
  }
}

function paintCategories(){
  const root=$('#categories');
  const list=visibleCategories();
  root.innerHTML=list.map((c,i)=>'<button class="catBtn '+(i===0?'active':'')+'" data-cat="'+esc(c.id)+'" type="button">'+esc(categoryName(c))+'</button>').join('');
  root.querySelectorAll('.catBtn').forEach(b=>b.onclick=()=>{
    root.querySelectorAll('.catBtn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    document.querySelector('[data-section="'+CSS.escape(b.dataset.cat)+'"]')?.scrollIntoView({behavior:'smooth',block:'start'});
  });
}

function productImage(p,cls=''){
  if(p.imageUrl)return '<img class="'+cls+'" src="'+esc(p.imageUrl)+'" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\'"><div class="productFallback" style="display:none">DC</div>';
  return '<div class="productFallback">DC</div>';
}
function cardAction(p){
  const q=productQty(p.id);
  if(!q)return '<button class="addBtn" data-add="'+esc(p.id)+'" type="button" aria-label="Добавить">+</button>';
  return '<div class="cardQty"><button data-minus-card="'+esc(p.id)+'" type="button">−</button><span>'+q+'</span><button data-plus-card="'+esc(p.id)+'" type="button">+</button></div>';
}
function productCard(p){
  const w=Number(p.weightGrams)>0?Math.round(p.weightGrams)+' г':'';
  return '<article class="productCard" data-product="'+esc(p.id)+'">'+
    '<div class="productPhoto">'+productImage(p)+'</div>'+
    '<div class="productBody"><div class="productName">'+esc(p.name)+' <span class="productWeight">'+esc(w)+'</span></div>'+
    '<div class="productDesc">'+esc(p.description||'')+'</div>'+
    '<div class="productBottom"><div class="productPrice">'+money(p.price)+'</div><div data-action="'+esc(p.id)+'">'+cardAction(p)+'</div></div></div>'+
  '</article>';
}
function paintMenu(){
  const root=$('#menuRoot');
  root.innerHTML=visibleCategories().map(c=>{
    const list=products.filter(p=>p.categoryId===c.id&&productIsAvailable(p));
    if(!list.length)return '';
    return '<section class="menuGroup" data-section="'+esc(c.id)+'">'+
      '<div class="menuGroupTitle"><h3>'+esc(categoryName(c))+'</h3><span class="menuSource">'+list.length+' поз.</span></div>'+
      '<div class="menuGrid">'+list.map(productCard).join('')+'</div></section>';
  }).join('');
  bindProductUI(root);
  observeCategories();
}
function observeCategories(){
  categoryObserver?.disconnect();
  categoryObserver=new IntersectionObserver(entries=>{
    const entry=entries.find(x=>x.isIntersecting);if(!entry)return;
    document.querySelectorAll('.catBtn').forEach(b=>b.classList.toggle('active',b.dataset.cat===entry.target.dataset.section));
  },{rootMargin:'-135px 0px -55% 0px'});
  document.querySelectorAll('.menuGroup').forEach(el=>categoryObserver.observe(el));
}
function bindProductUI(scope=document){
  scope.querySelectorAll('[data-product]').forEach(card=>card.onclick=e=>{
    if(e.target.closest('button'))return;
    const p=products.find(x=>x.id===card.dataset.product); if(p)openProduct(p);
  });
  scope.querySelectorAll('[data-add]').forEach(b=>b.onclick=e=>{e.stopPropagation();const p=products.find(x=>x.id===b.dataset.add);if(p)handleProduct(p)});
  scope.querySelectorAll('[data-plus-card]').forEach(b=>b.onclick=e=>{e.stopPropagation();const p=products.find(x=>x.id===b.dataset.plusCard);if(p)increaseProduct(p)});
  scope.querySelectorAll('[data-minus-card]').forEach(b=>b.onclick=e=>{e.stopPropagation();decreaseProduct(b.dataset.minusCard)});
}
function refreshCardActions(){
  document.querySelectorAll('[data-action]').forEach(box=>{
    const p=products.find(x=>x.id===box.dataset.action);
    if(p)box.innerHTML=cardAction(p);
  });
  bindProductUI(document);
}
function handleProduct(p){if(!productIsAvailable(p))return;hasModifiers(p)?openProduct(p):addSimple(p)}
function addSimple(p){
  if(!menuReady||!productIsAvailable(p))return;
  const key=p.id+'|';
  const line=cart.find(x=>x.key===key);
  if(line)line.q++;else cart.push({key,productId:p.id,itemId:p.itemId,name:p.name,imageUrl:p.imageUrl||'',basePrice:Number(p.price)||0,unitPrice:Number(p.price)||0,q:1,mods:[],modifierIds:[]});
  afterCartChange(true);
}
function increaseProduct(p){
  const line=[...cart].reverse().find(x=>x.productId===p.id);
  if(line){line.q++;afterCartChange(false)}else handleProduct(p);
}
function decreaseProduct(id){
  for(let i=cart.length-1;i>=0;i--){if(cart[i].productId===id){cart[i].q--;if(cart[i].q<=0)cart.splice(i,1);break}}
  afterCartChange(false);
}
function afterCartChange(open){
  saveCart();updateCart();refreshCardActions();
  if(open)notifyCart('Добавлено в корзину');
}
function notifyCart(message){
  clearTimeout(noticeTimer);$('#cartNotice').textContent=message;$('#cartNotice').classList.add('show');
  noticeTimer=setTimeout(()=>$('#cartNotice').classList.remove('show'),3500);
}

function openProduct(p){
  if(!menuReady||!productIsAvailable(p))return;
  selectedProduct=p;
  document.body.classList.add('modalOpen');
  const groups=visibleGroups(p);
  const groupHtml=groups.map((g,gi)=>{
    const max=Number(g.maxQuantity)||0;
    const min=Number(g.minQuantity)||0;
    const radio=max===1&&min>0;
    const name='g'+gi;
    const option=m=>{
      const input=radio?'radio':'checkbox';
      const checked=Number(m.byDefault)>0?'checked':'';
      return '<label class="modOpt '+(Number(m.price)>0?'premiumOpt':'')+'"><input class="modInput" type="'+input+'" name="'+name+'" value="'+esc(m.id)+'" data-group="'+esc(g.id||'')+'" data-price="'+Number(m.price||0)+'" data-name="'+esc(m.name||'')+'" '+checked+'><b>'+esc(m.name||'Добавка')+'</b><small>'+(Number(m.price)>0?'+'+money(m.price):'Без доплаты')+'</small></label>';
    };
    const paid=g.items.filter(m=>Number(m.price)>0),free=g.items.filter(m=>!Number(m.price));
    const exclusions=free.filter(m=>/^(?:-\s*)?без\s/i.test(m.name||''));
    const other=free.filter(m=>!exclusions.includes(m));
    const freeBlock=(title,items)=>items.length?'<section class="freeModifierBlock"><h3>'+title+'</h3>'+items.map(option).join('')+'</section>':'';
    const paidBlock=paid.length?'<section class="premiumModifierBlock"><div class="premiumModifierHead"><h3>Сделать вкуснее</h3><span>Рекомендуем</span></div><p>Добавьте любимое дополнение</p>'+paid.map(option).join('')+'</section>':'';
    return '<div class="modGroup" data-min="'+min+'" data-max="'+max+'" data-name="'+esc(g.name||'Добавки')+'"><div class="modGroupTitle"><strong>'+esc(g.name||'Настройки')+'</strong><small>'+(min>0?'Выберите '+(min===max?min:'от '+min):'По желанию')+(max>0&&min!==max?' · до '+max:'')+'</small></div>'+paidBlock+freeBlock('Убрать из блюда',exclusions)+freeBlock(/вкус/i.test(g.name||'')||/ava/i.test(p.name||'')?'Выберите вкус':'Настроить под себя',other)+'</div>';
  }).join('');
  const w=Number(p.weightGrams)>0?Math.round(p.weightGrams)+' г':'';
  $('#modalRoot').innerHTML='<div class="modalOverlay"><div class="modal productModal" role="dialog" aria-modal="true" aria-label="'+esc(p.name)+'">'+
    '<div class="productHero">'+productImage(p)+'</div>'+
    '<div class="productInfo"><div class="productNavigation"><button id="prevProduct" type="button" aria-label="Предыдущее блюдо">←</button><span>Выберите своё любимое</span><button id="nextProduct" type="button" aria-label="Следующее блюдо">→</button></div><div class="modalTop"><div><h2>'+esc(p.name)+'</h2><div class="modalMeta">'+esc(w)+'</div></div><button class="modalClose" id="modalClose" type="button" aria-label="Закрыть">×</button></div>'+
    '<div class="modalDesc">'+esc(p.description||'')+'</div>'+groupHtml+
    '<div id="productValidation" role="status" class="productValidation"></div><div class="modalActions"><button class="secondaryBtn" id="modalBack" type="button">Назад</button><button class="primaryBtn" id="confirmProduct" type="button">Добавить · '+money(p.price)+'</button></div></div></div></div>';
  $('#modalClose').onclick=closeModal; $('#modalBack').onclick=closeModal;
  $('#modalRoot .modalOverlay').onclick=e=>{if(e.target.classList.contains('modalOverlay'))closeModal()};
  document.querySelectorAll('.modInput').forEach(i=>i.onchange=updateProductButton);
  $('#confirmProduct').onclick=confirmProduct;
  $('#prevProduct').onclick=()=>navigateProduct(-1);$('#nextProduct').onclick=()=>navigateProduct(1);
  updateProductButton();
  $('#modalClose').focus();
}
function navigateProduct(direction){
  const list=products.filter(productIsAvailable),index=list.findIndex(p=>p.id===selectedProduct?.id);
  if(list.length)openProduct(list[(index+direction+list.length)%list.length]);
}
function updateProductButton(){
  if(!selectedProduct)return;
  let extra=0,valid=productIsAvailable(selectedProduct),messages=[];
  document.querySelectorAll('.modGroup').forEach(g=>{
    const n=g.querySelectorAll('.modInput:checked').length;
    const min=Number(g.dataset.min)||0,max=Number(g.dataset.max)||0;
    if(n<min||(max>0&&n>max)){valid=false;messages.push(n<min?'Выберите '+min+': '+g.dataset.name:'Можно выбрать не больше '+max+': '+g.dataset.name)}
    g.querySelectorAll('.modInput').forEach(i=>i.disabled=i.type!=='radio'&&!i.checked&&max>0&&n>=max);
  });
  document.querySelectorAll('.modInput:checked').forEach(i=>extra+=Number(i.dataset.price)||0);
  const b=$('#confirmProduct'); if(b){b.disabled=!valid;b.textContent='Добавить · '+money(Number(selectedProduct.price||0)+extra)}
  $('#productValidation').textContent=messages.join('. ');
}
function confirmProduct(){
  if(!selectedProduct)return;
  updateProductButton();
  const btn=$('#confirmProduct'); if(btn?.disabled)return;
  const mods=[];let extra=0;
  document.querySelectorAll('.modInput:checked').forEach(i=>{mods.push({id:i.value,groupId:i.dataset.group,name:i.dataset.name,price:Number(i.dataset.price)||0});extra+=Number(i.dataset.price)||0});
  const ids=mods.map(m=>m.id).sort();
  const key=selectedProduct.id+'|'+ids.join(',');
  const line=cart.find(x=>x.key===key);
  if(line)line.q++;else cart.push({key,productId:selectedProduct.id,itemId:selectedProduct.itemId,name:selectedProduct.name,imageUrl:selectedProduct.imageUrl||'',basePrice:Number(selectedProduct.price)||0,unitPrice:Number(selectedProduct.price||0)+extra,q:1,mods,modifierIds:mods.map(m=>m.id)});
  closeModal();afterCartChange(true);
}
function closeModal(){$('#modalRoot').innerHTML='';selectedProduct=null;document.body.classList.remove('modalOpen')}

function openCart(){
  $('#profilePopover').classList.remove('open');
  $('#cartDrawer').classList.add('open');$('#drawerBackdrop').classList.add('show');document.body.classList.add('drawerOpen');$('#cartDrawer').setAttribute('aria-hidden','false');
}
function closeCart(){
  $('#cartDrawer').classList.remove('open');$('#drawerBackdrop').classList.remove('show');document.body.classList.remove('drawerOpen');$('#cartDrawer').setAttribute('aria-hidden','true');
}
function updateCart(){
  const n=cartCount(),sum=total();
  $('#cartTopCount').textContent=n;
  $('#mobileCart').hidden=!n;$('#mobileCartCount').textContent=n;$('#mobileCartTotal').textContent=money(sum);
  $('#cartCountText').textContent=n+' '+plural(n,'позиция','позиции','позиций');
  $('#cartSubtotal').textContent=money(sum);$('#cartTotal').textContent=money(sum);$('#footerTotal').textContent=money(sum);
  $('#checkoutBtn').disabled=!cart.length||!menuReady;
  const lines=$('#cartLines');
  if(!cart.length){
    lines.innerHTML='<div class="emptyCart"><b>Корзина пока пустая</b><span>Добавьте блюда из меню</span></div>';
  }else{
    lines.innerHTML=cart.map((x,i)=>{
      const mods=(x.mods||[]).map(m=>m.name).filter(Boolean).join(' · ');
      return '<div class="cartLine"><div class="cartThumb">'+(x.imageUrl?'<img src="'+esc(x.imageUrl)+'" alt="">':'<div class="productFallback">DC</div>')+'</div>'+
        '<div><div class="cartLineName">'+esc(x.name)+'</div>'+(mods?'<div class="cartLineMods">'+esc(mods)+'</div>':'')+
        '<div class="cartLineBottom"><div class="miniQty"><button data-cart-minus="'+i+'" type="button">−</button><span>'+x.q+'</span><button data-cart-plus="'+i+'" type="button">+</button></div></div></div>'+
        '<div class="cartLinePrice">'+money(x.unitPrice*x.q)+'</div></div>';
    }).join('');
    lines.querySelectorAll('[data-cart-plus]').forEach(b=>b.onclick=()=>{cart[+b.dataset.cartPlus].q++;afterCartChange(false)});
    lines.querySelectorAll('[data-cart-minus]').forEach(b=>b.onclick=()=>{const i=+b.dataset.cartMinus;cart[i].q--;if(cart[i].q<=0)cart.splice(i,1);afterCartChange(false)});
  }
  paintRecommendations();
  updateFulfillmentUI();
}
function plural(n,a,b,c){n=Math.abs(n)%100;const n1=n%10;if(n>10&&n<20)return c;if(n1>1&&n1<5)return b;if(n1===1)return a;return c}
function paintRecommendations(){
  const root=$('#recommendRail'); if(!root)return;
  const inCart=new Set(cart.map(x=>x.productId));
  const recs=products.filter(p=>productIsAvailable(p)&&!inCart.has(p.id)&&recommendationPriority(p)<11).sort((a,b)=>recommendationPriority(a)-recommendationPriority(b)||Number(a.price)-Number(b.price));
  $('#recommendBlock').style.display=recs.length?'block':'none';
  root.innerHTML=recs.map(p=>'<button class="recCard" data-rec="'+esc(p.id)+'" type="button"><div class="recPhoto">'+productImage(p)+'</div><div class="recName">'+esc(p.name)+'</div><div class="recPrice">'+money(p.price)+'</div></button>').join('');
  root.querySelectorAll('[data-rec]').forEach(b=>b.onclick=()=>{const p=products.find(x=>x.id===b.dataset.rec);if(p)handleProduct(p)});
}
function recommendationPriority(p){
  const name=String(p.name||'').toLowerCase(),category=String(categories.find(c=>c.id===p.categoryId)?.name||'').toLowerCase();
  const checks=[/стрип/,/картофель фри|^фри$| фри/,/медов.*соус|соус.*медов/,/фирмен.*соус|соус.*фирмен/,/пончик/,/bubble/,/чай|lipton/,/чесноч.*соус|соус.*чесноч/,/соус/,/pepsi|айран|mirinda|вода|пиала|ava|кинза/,/десерт|слад/];
  const rank=checks.findIndex(re=>re.test(name));return rank<0?(/напит|бар|дополн|чай|слад/.test(category)?10:11):rank;
}

function updateFulfillmentUI(){
  const mode=fulfillment.mode==='pickup'?'Самовывоз':'Доставка';
  const val=fulfillment.value||(fulfillment.mode==='pickup'?'Выберите точку':'Укажите адрес доставки');
  $('#locationText').textContent='Астана · '+mode;
  $('#fulfillmentLabel').textContent=mode;
  $('#fulfillmentValue').textContent=val;
  $('#cartModeLabel').textContent=mode;
  $('#cartModeValue').textContent=val;
  $('#deliveryPrice').textContent=fulfillment.mode==='pickup'?'Самовывоз · бесплатно':'Скоро';
}
function openFulfillment(){
  const pickup=fulfillment.mode==='pickup';
  $('#modalRoot').innerHTML='<div class="modalOverlay"><div class="modal simpleModal"><div class="modalTop"><div><h2>Как получить заказ?</h2><p>Выберите доставку или самовывоз.</p></div><button class="modalClose" id="modalClose" type="button">×</button></div>'+
    '<div class="segment"><button class="'+(!pickup?'active':'')+'" data-mode="delivery" type="button">Доставка</button><button class="'+(pickup?'active':'')+'" data-mode="pickup" type="button">Самовывоз</button></div>'+
    '<div id="fulfillmentFields"></div>'+
    '<div class="modalActions"><button class="secondaryBtn" id="modalBack" type="button">Отмена</button><button class="primaryBtn" id="saveFulfillment" type="button">Сохранить</button></div></div></div>';
  $('#modalClose').onclick=closeModal;$('#modalBack').onclick=closeModal;
  let draft={...fulfillment};
  const paint=()=>{
    document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===draft.mode));
    const f=$('#fulfillmentFields');
    if(draft.mode==='delivery'){
      f.innerHTML='<section class="deliveryNotice"><span class="deliveryIcon" aria-hidden="true">↗</span><h3>Доставка скоро появится</h3><p>Мы активно готовим запуск и подбираем надёжных партнёров, чтобы привозить ваши любимые блюда быстро и горячими.</p><p>А пока можно выбрать удобную точку самовывоза.</p></section>';
      $('#saveFulfillment').textContent='Выбрать самовывоз';$('#saveFulfillment').disabled=false;
    }else{
      f.innerHTML='<div class="pointList">'+
        '<button class="pointBtn" data-point="Арай, 1А" type="button"><strong>Doner Club Арай</strong><small>Арай, 1А</small></button>'+
        '<button class="pointBtn" data-point="Республика, 4" type="button"><strong>Doner Club Республика</strong><small>Республика, 4</small></button>'+
      '</div>';
      $('#saveFulfillment').textContent='Сохранить';$('#saveFulfillment').disabled=!draft.value;
      f.querySelectorAll('[data-point]').forEach(b=>{b.classList.toggle('selected',b.dataset.point===draft.value);b.setAttribute('aria-pressed',String(b.dataset.point===draft.value));b.onclick=()=>{draft.value=b.dataset.point;paint()}});
    }
  };
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{draft.mode=b.dataset.mode;draft.value=fulfillment.mode==='pickup'?fulfillment.value:'';paint()});
  paint();
  $('#saveFulfillment').onclick=()=>{
    if(draft.mode==='delivery'){draft.mode='pickup';draft.value=fulfillment.value||'';paint();return}
    if(!draft.value)return;
    const beforePoint=currentPointConfig().key;
    fulfillment=draft;
    const afterPoint=currentPointConfig().key;
    saveFulfillment();updateFulfillmentUI();closeModal();

    if(beforePoint!==afterPoint){
      // Menu, prices and stop-list are point-specific. Do not keep a cart
      // assembled for another branch.
      cart=[];
      stoppedProductIds={};
      saveCart();
      updateCart();
      loadMenu();
      notifyCart('Точка изменена. Корзина очищена — цены и наличие могут отличаться.');
    }
  };
}

function updateProfileUI(){
  $('#profileLabel').textContent=profile?.name||'Войти';
  $('#profileName').textContent=profile?.name||'Гость';
  $('#profilePhone').textContent=profile?.phone||'Войдите по номеру телефона';
  $('#logoutBtn').style.display=profile?'flex':'none';
}
function profileClick(){
  if(!profile){openLogin();return}
  $('#cartDrawer').classList.remove('open');$('#drawerBackdrop').classList.remove('show');document.body.classList.remove('drawerOpen');
  $('#profilePopover').classList.toggle('open');
}
function openLogin(){
  $('#profilePopover').classList.remove('open');
  $('#modalRoot').innerHTML='<div class="modalOverlay"><div class="modal simpleModal"><div class="modalTop"><div><h2>Войти в Doner Club</h2><p>Пока используем простую тестовую авторизацию. Позже подключим подтверждение номера через CRM.</p></div><button class="modalClose" id="modalClose" type="button">×</button></div>'+
    '<label class="field"><span>Имя</span><input id="loginName" placeholder="Ваше имя"></label>'+
    '<label class="field"><span>Телефон</span><input id="loginPhone" inputmode="tel" value="+7 " placeholder="+7 700 000 00 00" autocomplete="tel"></label>'+
    '<button class="primaryBtn" id="loginSave" style="width:100%;margin-top:8px" type="button">Продолжить</button></div></div>';
  $('#modalClose').onclick=closeModal;

  const phoneInput=$('#loginPhone');
  const formatLoginPhone=()=>{
    let digits=phoneInput.value.replace(/\D/g,'');
    if(digits.charAt(0)==='7')digits=digits.slice(1);
    else if(digits.charAt(0)==='8'&&digits.length>10)digits=digits.slice(1);
    digits=digits.slice(0,10);
    const a=digits.slice(0,3),b=digits.slice(3,6),d=digits.slice(6,8),e=digits.slice(8,10);
    phoneInput.value='+7'+(a?' '+a:'')+(b?' '+b:'')+(d?' '+d:'')+(e?' '+e:'')+(digits.length===0?' ':'');
  };
  phoneInput.addEventListener('input',formatLoginPhone);
  phoneInput.addEventListener('focus',()=>{
    if(!phoneInput.value.startsWith('+7'))formatLoginPhone();
    requestAnimationFrame(()=>phoneInput.setSelectionRange(phoneInput.value.length,phoneInput.value.length));
  });
  phoneInput.addEventListener('keydown',event=>{
    if((event.key==='Backspace'||event.key==='Delete')&&phoneInput.selectionStart<=3&&phoneInput.selectionEnd<=3){
      event.preventDefault();
    }
  });

  $('#loginSave').onclick=()=>{
    const name=$('#loginName').value.trim(),phone=$('#loginPhone').value.trim();
    const digits=phone.replace(/\D/g,'');
    if(!name||digits.length!==11||digits.charAt(0)!=='7')return;
    profile={name,phone};localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));updateProfileUI();closeModal();$('#profilePopover').classList.add('open');
  };
}
function showInfo(title,text){
  $('#modalRoot').innerHTML='<div class="modalOverlay"><div class="modal simpleModal"><div class="modalTop"><div><h2>'+esc(title)+'</h2><p>'+esc(text)+'</p></div><button class="modalClose" id="modalClose" type="button">×</button></div><button class="primaryBtn" id="modalOk" style="width:100%;margin-top:6px" type="button">Хорошо</button></div></div>';
  $('#modalClose').onclick=closeModal;$('#modalOk').onclick=closeModal;
}
function openTextModal(type){
  const isComment=type==='comment';
  const title=isComment?'Комментарий к заказу':'Промокод';
  const current=isComment?comment:promo;
  $('#modalRoot').innerHTML='<div class="modalOverlay"><div class="modal simpleModal"><div class="modalTop"><h2>'+title+'</h2><button class="modalClose" id="modalClose" type="button">×</button></div>'+
    (isComment?'<label class="field"><span>Комментарий</span><textarea id="textValue" placeholder="Например: не звонить в домофон">'+esc(current)+'</textarea></label>':'<label class="field"><span>Промокод</span><input id="textValue" value="'+esc(current)+'" placeholder="Введите промокод"></label>')+
    '<button class="primaryBtn" id="saveText" style="width:100%" type="button">Сохранить</button></div></div>';
  $('#modalClose').onclick=closeModal;
  $('#saveText').onclick=()=>{const v=$('#textValue').value.trim();if(isComment){comment=v;$('#commentPreview').textContent=v}else{promo=v;$('#promoPreview').textContent=v}closeModal()};
}
function openCheckout(){
  if(!cart.length)return;
  const needAddress=fulfillment.mode==='delivery'&&!fulfillment.value;
  $('#modalRoot').innerHTML='<div class="modalOverlay"><div class="modal simpleModal"><div class="modalTop"><div><h2>Оформление заказа</h2><p>Корзина уже работает. На следующем этапе подключим создание заказа в CRM, оплату и доставку.</p></div><button class="modalClose" id="modalClose" type="button">×</button></div>'+
    (needAddress?'<button class="primaryBtn" id="setAddressNow" style="width:100%;margin-bottom:8px" type="button">Указать адрес</button>':'')+
    '<div class="cartSummary"><div><span>Сумма корзины</span><b>'+money(total())+'</b></div><div><span>Получение</span><b>'+(fulfillment.mode==='pickup'?'Самовывоз':'Доставка')+'</b></div></div>'+
    '<button class="primaryBtn" style="width:100%;margin-top:14px;opacity:.5" type="button" disabled>Оплата будет подключена следующим этапом</button></div></div>';
  $('#modalClose').onclick=closeModal;
  if($('#setAddressNow'))$('#setAddressNow').onclick=()=>{closeModal();openFulfillment()};
}

$('#heroOrderBtn').onclick=()=>$('#menu').scrollIntoView({behavior:'smooth'});
$('#directOrderBtn').onclick=$('#heroOrderBtn').onclick;
$('#mobileCart').onclick=openCart;
$('#locationBtn').onclick=openFulfillment;
$('#fulfillmentMain').onclick=openFulfillment;
$('#cartFulfillment').onclick=openFulfillment;
$('#profileBtn').onclick=profileClick;
$('#cartTopBtn').onclick=openCart;
$('#cartClose').onclick=closeCart;
$('#drawerBackdrop').onclick=closeCart;
$('#clearCart').onclick=()=>{cart=[];afterCartChange(false)};
$('#commentBtn').onclick=()=>openTextModal('comment');
$('#promoBtn').onclick=()=>openTextModal('promo');
$('#etaButton').onclick=()=>showInfo('Время получения','Когда подключим реальные заказы, здесь можно будет выбрать ближайшее или запланированное время.');
$('#checkoutBtn').onclick=openCheckout;
$('#langBtn').onclick=()=>showInfo('Казахский язык','Переключатель RU/KZ подключим после завершения основной логики сайта.');
$('#logoutBtn').onclick=()=>{profile=null;localStorage.removeItem(PROFILE_KEY);updateProfileUI();$('#profilePopover').classList.remove('open')};
document.querySelectorAll('[data-profile-action]').forEach(b=>b.onclick=()=>{
  if(!profile){openLogin();return}
  const map={orders:['Мои заказы','Здесь появится история заказов из CRM.'],addresses:['Мои адреса','Здесь будут сохранённые адреса доставки.'],data:['Мои данные','Здесь можно будет изменить имя и контактные данные.'],cards:['Банковские карты','Здесь будут сохранённые способы оплаты.']};
  const x=map[b.dataset.profileAction];showInfo(x[0],x[1]);
});
document.addEventListener('click',e=>{if(!e.target.closest('#profilePopover')&&!e.target.closest('#profileBtn'))$('#profilePopover').classList.remove('open')});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();closeCart();$('#profilePopover').classList.remove('open')}});

loadState();
loadMenu();

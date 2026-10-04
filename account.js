// Unverified local profiles cannot access customer CRM data.
// Card details are entered only on PayLink's hosted payment page, never stored here.
const CUSTOMER_API='https://doner-club-crm.onrender.com/api/customer';
const CUSTOMER_TOKEN_KEY='donerclub-customer-session-v1';
let addressCache=[],addressVersion=0,accountView=0;
function customerToken(){return sessionStorage.getItem(CUSTOMER_TOKEN_KEY)||''}
async function customerRequest(path,method='GET',data){
  const r=await fetch(CUSTOMER_API+path,{method,headers:{'Content-Type':'application/json',...(customerToken()?{Authorization:'Bearer '+customerToken()}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
  const result=await r.json();
  if(r.status===401){sessionStorage.removeItem(CUSTOMER_TOKEN_KEY);if(profile)profile.verified=false}
  if(!r.ok||!result.ok)throw new Error(result.error||'Не удалось загрузить данные');
  return result;
}
async function restoreCustomerSession(){
  if(!customerToken()){if(profile)profile.verified=false;return}
  try{const result=await customerRequest('/profile');profile=result.profile;updateProfileUI()}catch{}
}
function readAddressBook(){
  if(customerToken())return addressCache;
  try{const data=JSON.parse(localStorage.getItem(addressBookKey())||'[]');return Array.isArray(data)?data:[]}catch{return []}
}
function addressBookKey(){return 'donerclub-addresses-v1-'+String(profile?.phone||'').replace(/\D/g,'')}
async function saveAddressBook(items){
  if(customerToken()){
    try{const result=await customerRequest('/addresses','PUT',{addresses:items,version:addressVersion});addressCache=result.addresses;addressVersion=result.version;return true}catch(e){notifyCart(e.message);return false}
  }
  try{localStorage.setItem(addressBookKey(),JSON.stringify(items));return true}catch{notifyCart('Не удалось сохранить. Проверьте настройки хранения данных в браузере.');return false}
}
function accountShell(title,body){
  accountView++;
  $('#profilePopover').classList.remove('open');
  $('#profilePopover').setAttribute('aria-hidden','true');
  document.body.classList.add('modalOpen');
  $('#modalRoot').innerHTML='<div class="modalOverlay"><section class="modal accountModal" role="dialog" aria-modal="true" aria-labelledby="accountTitle"><div class="modalTop"><h2 id="accountTitle">'+esc(title)+'</h2><button class="modalClose" id="modalClose" type="button" aria-label="Закрыть">×</button></div><nav class="accountTabs" aria-label="Личный кабинет">'+[['orders','Мои заказы'],['addresses','Мои адреса'],['data','Мои данные'],['cards','Банковские карты']].map(([key,label])=>'<button type="button" data-account-tab="'+key+'" class="'+(label===title?'active':'')+'" '+(label===title?'aria-current="page"':'')+'>'+label+'</button>').join('')+'</nav>'+body+'</section></div>';
  $('#modalClose').onclick=closeModal;
  $('#modalRoot .modalOverlay').onclick=e=>{if(e.target.classList.contains('modalOverlay'))closeModal()};
  document.querySelectorAll('[data-account-tab]').forEach(b=>b.onclick=()=>openAccountSection(b.dataset.accountTab));
  $('#modalClose').focus();
}
function openAccountSection(section){
  if(!profile){openLogin();return}
  ({orders:openAccountOrders,addresses:openAccountAddresses,data:openAccountData,cards:openAccountCards}[section]||openAccountData)();
}
function openAccountData(){
  accountShell('Мои данные','<p class="accountNote">'+(customerToken()?'Номер подтверждён через Telegram. Данные сохраняются в вашем профиле.':'Данные сохраняются на этом устройстве. Для доступа к CRM подтвердите номер через Telegram.')+'</p>'+(!customerToken()?'<button id="verifyAccount" class="secondaryBtn accountFull" type="button">Подтвердить номер через Telegram</button>':'')+'<form id="profileForm"><label class="field"><span>Имя</span><input name="name" autocomplete="given-name" maxlength="80" required value="'+esc(profile.name||'')+'"></label><label class="field"><span>Телефон</span><input value="'+esc(profile.phone||'')+'" readonly aria-describedby="phoneHelp"></label><p id="phoneHelp" class="accountNote">Чтобы указать другой номер, выйдите из профиля и введите его заново.</p><label class="field"><span>Email — необязательно</span><input name="email" type="email" autocomplete="email" maxlength="254" value="'+esc(profile.email||'')+'"></label><button class="primaryBtn accountFull" type="submit">Сохранить изменения</button><p id="profileSaved" class="formStatus" role="status"></p></form>');
  if($('#verifyAccount'))$('#verifyAccount').onclick=openTelegramLogin;
  $('#profileForm').onsubmit=async e=>{
    e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;
    const name=form.elements.name.value.trim();if(!name){form.elements.name.setCustomValidity('Введите имя');form.elements.name.reportValidity();return}
    let next={...profile,name,email:form.elements.email.value.trim()};
    const status=$('#profileSaved'),button=form.querySelector('[type=submit]');button.disabled=true;
    try{if(customerToken())next=(await customerRequest('/profile','PUT',next)).profile;localStorage.setItem(PROFILE_KEY,JSON.stringify(next));profile=next;updateProfileUI();status.textContent='Изменения сохранены'}catch(e){status.textContent=e.message||'Не удалось сохранить данные'}finally{button.disabled=false}
  };
  $('#profileForm').elements.name.oninput=e=>e.target.setCustomValidity('');
}
async function openAccountAddresses(){
  if(customerToken()){
    accountShell('Мои адреса','<p class="accountNote" role="status">Загружаем адреса…</p>');const view=accountView;
    try{const result=await customerRequest('/addresses');if(view!==accountView||!$('#accountTitle'))return;addressCache=result.addresses;addressVersion=result.version}catch(e){if(view===accountView&&$('#accountTitle'))accountShell('Мои адреса','<p class="accountNotice">'+esc(e.message)+'</p>');return}
  }
  const items=readAddressBook();
  const list=items.length?'<div class="addressList">'+items.map(a=>'<article class="addressCard"><div><strong>'+esc(a.label||'Адрес')+'</strong>'+(a.primary?'<span class="addressBadge">Основной</span>':'')+'<p>'+esc(a.street)+(a.apartment?', кв. '+esc(a.apartment):'')+'</p><small>'+[a.entrance?'Подъезд '+a.entrance:'',a.floor?'Этаж '+a.floor:'',a.comment].filter(Boolean).map(esc).join(' · ')+'</small></div><div class="addressActions"><button type="button" data-edit-address="'+esc(a.id)+'">Изменить</button>'+(!a.primary?'<button type="button" data-primary-address="'+esc(a.id)+'">Сделать основным</button>':'')+'<button type="button" data-delete-address="'+esc(a.id)+'">Удалить</button></div></article>').join('')+'</div>':'<div class="accountEmpty"><span aria-hidden="true">⌖</span><h3>Сохраните удобный адрес</h3><p>Дом, работа или другой адрес — чтобы не вводить его каждый раз.</p></div>';
  accountShell('Мои адреса','<p class="accountNote">'+(customerToken()?'Адреса сохраняются в вашем профиле.':'Адреса сохраняются на этом устройстве.')+' Доставка готовится к запуску; сейчас доступен самовывоз.</p>'+list+'<button id="newAddress" class="primaryBtn accountFull" type="button">Добавить адрес</button>');
  $('#newAddress').onclick=()=>editAccountAddress();
  document.querySelectorAll('[data-edit-address]').forEach(b=>b.onclick=()=>editAccountAddress(b.dataset.editAddress));
  document.querySelectorAll('[data-primary-address]').forEach(b=>b.onclick=async()=>{b.disabled=true;if(await saveAddressBook(items.map(a=>({...a,primary:a.id===b.dataset.primaryAddress}))))openAccountAddresses();else b.disabled=false});
  document.querySelectorAll('[data-delete-address]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    const remaining=items.filter(a=>a.id!==b.dataset.deleteAddress);
    if(remaining.length&&!remaining.some(a=>a.primary))remaining[0].primary=true;
    if(await saveAddressBook(remaining)){openAccountAddresses();notifyCart('Адрес удалён')}else b.disabled=false;
  });
}
function editAccountAddress(id){
  const items=readAddressBook(),address=items.find(a=>a.id===id)||{};
  const field=(label,name,required=false)=>'<label class="field"><span>'+label+'</span><input name="'+name+'" maxlength="'+(name==='street'?160:60)+'" value="'+esc(address[name]||'')+'" '+(required?'required':'')+'></label>';
  accountShell('Мои адреса','<h3>'+ (id?'Изменить адрес':'Новый адрес')+'</h3><form id="addressForm">'+field('Название: например, Дом или Работа','label')+field('Астана · улица и дом','street',true)+'<div class="addressFormGrid">'+field('Квартира / офис','apartment')+field('Подъезд','entrance')+field('Этаж','floor')+'</div><label class="field"><span>Комментарий к адресу</span><textarea name="comment" maxlength="300" placeholder="Как найти вход">'+esc(address.comment||'')+'</textarea></label><label class="addressCheck"><input name="primary" type="checkbox" '+(address.primary||!items.length?'checked':'')+'>Основной адрес</label><div class="modalActions"><button id="cancelAddress" class="secondaryBtn" type="button">Отмена</button><button class="primaryBtn" type="submit">Сохранить адрес</button></div></form>');
  $('#cancelAddress').onclick=openAccountAddresses;
  $('#addressForm').onsubmit=async e=>{
    e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;
    const next={id:address.id||crypto.randomUUID(),primary:form.elements.primary.checked};
    for(const key of ['label','street','apartment','entrance','floor','comment'])next[key]=form.elements[key].value.trim();
    if(!next.street){form.elements.street.setCustomValidity('Введите улицу и дом');form.elements.street.reportValidity();return}
    let updated=items.filter(a=>a.id!==next.id);if(next.primary)updated=updated.map(a=>({...a,primary:false}));updated.push(next);
    if(!updated.some(a=>a.primary))updated[0].primary=true;
    const button=form.querySelector('[type=submit]');button.disabled=true;
    if(await saveAddressBook(updated)){openAccountAddresses();notifyCart('Адрес сохранён')}else button.disabled=false;
  };
  $('#addressForm').elements.street.oninput=e=>e.target.setCustomValidity('');
}
async function openAccountOrders(){
  if(customerToken()){
    accountShell('Мои заказы','<p class="accountNote" role="status">Загружаем заказы…</p>');const view=accountView;
    try{const result=await customerRequest('/orders');if(view!==accountView||!$('#accountTitle'))return;
      const statuses={COMPLETED:'Выполнен',CANCELLED:'Отменён',CANCELED:'Отменён',NEW:'Новый',PAID:'Оплачен',PENDING:'Ожидает подтверждения',COOKING:'Готовится',READY:'Готов к выдаче'};
      accountShell('Мои заказы',result.orders.length?'<div class="orderList">'+result.orders.map(o=>'<article class="addressCard"><strong>Заказ № '+esc(o.number)+'</strong><span class="addressBadge">'+esc(statuses[o.status]||'Статус уточняется')+'</span><p>'+esc(o.location)+'</p><small>'+esc(new Date(o.date).toLocaleString('ru-RU'))+'</small><p><b>'+money(o.total)+'</b></p></article>').join('')+'</div>':'<div class="accountEmpty"><h3>У вас пока нет заказов</h3><p>Здесь будет история заказов Doner Club, привязанных к вашему подтверждённому номеру.</p></div>');
    }catch(e){if(view===accountView&&$('#accountTitle'))accountShell('Мои заказы','<p class="accountNotice">'+esc(e.message)+'</p>')}
    return;
  }
  accountShell('Мои заказы','<div class="accountEmpty"><span aria-hidden="true">▣</span><h3>Ваши заказы Doner Club</h3><p>Подтвердите номер через Telegram, чтобы увидеть свою историю. Заказы из Starter не переносятся автоматически.</p></div><button class="primaryBtn accountFull" id="ordersLogin" type="button">Войти через Telegram</button>'+(cart.length?'<div class="accountCart"><div><strong>Ваша текущая корзина</strong><p>'+cartCount()+' '+plural(cartCount(),'позиция','позиции','позиций')+' · '+money(total())+'</p></div><button class="primaryBtn" id="accountCartBtn" type="button">Открыть корзину</button></div>':'')+'<button class="secondaryBtn accountFull" id="accountMenuBtn" type="button">Выбрать блюда</button>');
  $('#ordersLogin').onclick=openTelegramLogin;
  if($('#accountCartBtn'))$('#accountCartBtn').onclick=()=>{closeModal();openCart()};
  $('#accountMenuBtn').onclick=()=>{closeModal();closeCart();$('#menu').scrollIntoView({behavior:'smooth'})};
}
function openAccountCards(){
  accountShell('Банковские карты','<div class="paymentCardVisual" aria-hidden="true"><span>БАНКОВСКАЯ КАРТА</span><strong>•••• &nbsp; •••• &nbsp; •••• &nbsp; ••••</strong><span>PayLink · онлайн-оплата</span></div><h3>Оплата онлайн банковской картой</h3><p class="accountNote">Реквизиты вводятся на защищённой странице PayLink. Мы не сохраняем номер карты и CVC на сайте.</p><div class="accountNotice">Подключаем PayLink к новому сайту. Привязка карты и онлайн-оплата станут доступны после завершения подключения.</div><button id="cardMenuBtn" class="secondaryBtn accountFull" type="button">Перейти к меню</button>');
  $('#cardMenuBtn').onclick=()=>{closeModal();closeCart();$('#menu').scrollIntoView({behavior:'smooth'})};
}

async function openTelegramLogin(){
  accountShell('Войти в Doner Club','<p class="accountNote">Подтвердите номер через Telegram, чтобы видеть свои заказы и сохранять данные.</p><form id="telegramPhoneForm"><label class="field"><span>Телефон</span><input id="telegramPhone" inputmode="tel" autocomplete="tel" value="'+esc(profile?.phone||'+7 ')+'" required></label><button id="telegramStart" class="primaryBtn accountFull" type="submit">Получить код в Telegram</button><p id="telegramStatus" class="formStatus" role="status">Проверяем подключение…</p></form>');
  const input=$('#telegramPhone'),status=$('#telegramStatus'),button=$('#telegramStart'),loginView=accountView;
  button.disabled=true;
  input.oninput=()=>{let d=input.value.replace(/\D/g,'');if(d.startsWith('7')||d.startsWith('8'))d=d.slice(1);input.value='+7 '+d.slice(0,10)};
  input.onkeydown=e=>{if(['Backspace','Delete'].includes(e.key)&&input.selectionStart<=3&&input.selectionEnd<=3)e.preventDefault()};
  try{const config=await customerRequest('/config');button.disabled=!config.telegramEnabled;status.textContent=config.telegramEnabled?'Код придёт в бот Doner Club после подтверждения номера.':'Вход через Telegram готовится к запуску. Меню доступно без входа.'}catch{status.textContent='Не удалось подключиться. Закройте окно и попробуйте снова.'}
  if(loginView!==accountView)return;
  $('#telegramPhoneForm')?.addEventListener('submit',async e=>{
    e.preventDefault();if(button.disabled)return;
    const phone=input.value.replace(/\D/g,'');if(!/^7\d{10}$/.test(phone)){status.textContent='Введите 10 цифр после +7';return}
    button.disabled=true;status.textContent='Готовим вход…';const view=accountView;
    try{const challenge=await customerRequest('/auth/start','POST',{phone:'+'+phone});if(view!==accountView||!$('#telegramPhoneForm'))return;showTelegramCode(challenge)}catch(e){status.textContent=e.message;button.disabled=false}
  });
}
function showTelegramCode(challenge){
  accountShell('Код из Telegram','<p class="accountNote">1. Откройте бота и нажмите «Старт».<br>2. Нажмите «Подтвердить мой номер».<br>3. Введите полученный код здесь в течение 5 минут.</p><a class="primaryBtn accountFull" href="'+esc(challenge.telegramUrl)+'" target="_blank" rel="noopener noreferrer">Открыть Telegram</a><form id="telegramCodeForm"><label class="field"><span>Одноразовый код</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="6 цифр"></label><button class="primaryBtn accountFull" type="submit">Войти</button><p id="telegramCodeStatus" class="formStatus" role="status"></p></form><button id="restartLogin" class="secondaryBtn accountFull" type="button">Начать заново</button>');
  $('#restartLogin').onclick=openTelegramLogin;
  $('#telegramCodeForm').onsubmit=async e=>{
    e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;
    const button=form.querySelector('[type=submit]'),status=$('#telegramCodeStatus'),view=accountView;button.disabled=true;
    try{
      const result=await customerRequest('/auth/verify','POST',{challenge:challenge.challenge,browserSecret:challenge.browserSecret,code:form.elements.code.value});
      if(view!==accountView||!$('#telegramCodeForm'))return;
      sessionStorage.setItem(CUSTOMER_TOKEN_KEY,result.token);profile=result.profile;localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));updateProfileUI();openAccountData();notifyCart('Номер подтверждён. Вы вошли в Doner Club.');
    }catch(e){status.textContent=e.message;button.disabled=false}
  };
}
async function logoutCustomer(){
  const token=customerToken();
  if(token){try{await customerRequest('/logout','POST',{})}catch(e){if(customerToken()){notifyCart('Не удалось завершить сеанс. Попробуйте ещё раз.');return}}}
  sessionStorage.removeItem(CUSTOMER_TOKEN_KEY);profile=null;localStorage.removeItem(PROFILE_KEY);addressCache=[];accountView++;updateProfileUI();closeModal();$('#profilePopover').classList.remove('open');
}

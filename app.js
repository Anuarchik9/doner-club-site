const modes=[...document.querySelectorAll('.mode')];
const address=document.getElementById('address');
const fieldLabel=document.getElementById('fieldLabel');
const helper=document.getElementById('helper');
let mode='delivery';

function renderMode(){
  modes.forEach(button=>button.classList.toggle('active',button.dataset.mode===mode));
  if(mode==='delivery'){
    fieldLabel.textContent='Адрес доставки';
    address.placeholder='Введите улицу и дом';
    helper.textContent='На следующем этапе подключим определение зоны доставки через CRM.';
  }else{
    fieldLabel.textContent='Точка самовывоза';
    address.placeholder='Выберите точку Doner Club';
    helper.textContent='На следующем этапе список активных точек будет приходить из CRM.';
  }
}

modes.forEach(button=>{
  button.addEventListener('click',()=>{
    mode=button.dataset.mode;
    renderMode();
  });
});

document.getElementById('continue').addEventListener('click',()=>{
  const value=address.value.trim();
  if(!value){
    address.focus();
    return;
  }
  alert(mode==='delivery'
    ? 'Следующий этап — подключение адреса и меню к CRM.'
    : 'Следующий этап — подключение списка точек и меню к CRM.');
});

document.querySelectorAll('.chip').forEach(button=>{
  button.addEventListener('click',()=>{
    document.querySelectorAll('.chip').forEach(item=>item.classList.remove('active'));
    button.classList.add('active');
  });
});

renderMode();

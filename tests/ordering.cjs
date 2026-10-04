// Run: node tests/ordering.cjs. No live orders or payment requests.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const nodes=new Map();
const node=()=>({textContent:'',innerHTML:'',hidden:false,disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},querySelectorAll(){return []},setAttribute(){},focus(){}});
const document={body:node(),querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)},querySelectorAll(){return []}};
const timers=[];
const ctx=vm.createContext({document,console,AbortSignal,localStorage:{setItem(){}},setTimeout(fn,ms){timers.push({fn,ms});return timers.length},clearTimeout(){},IntersectionObserver:class{observe(){}disconnect(){}},CSS:{escape:s=>s}});
vm.runInContext(source.slice(0,source.indexOf("$('#heroOrderBtn').onclick=")),ctx);
const run=s=>vm.runInContext(s,ctx);
run(`products=[{id:'food',itemId:'FOOD',price:1000,name:'Донер',modifierGroups:[{id:'extras',name:'Допы',minQuantity:0,maxQuantity:1,items:[{id:'cheese',name:'Сыр',price:200},{id:'omit',name:'- без огурцов',price:0}]}]},{id:'drink',itemId:'DRINK',name:'Ava',price:800,modifierGroups:[{id:'flavor',name:'Вкус',minQuantity:1,maxQuantity:1,items:[{id:'apple',name:'Яблоко',price:0}]}]}];menuReady=true;`);
assert.match(run('kioskMenuUrl()'),/point=Arai/);
run("fulfillment={mode:'pickup',value:'Республика, 4'}");
assert.match(run('kioskMenuUrl()'),/point=RESPUBLIKA/);
assert.match(decodeURIComponent(run('kioskMenuUrl()')),/Kiosk Республика/);
run('openProduct(products[0])');
const html=nodes.get('#modalRoot').innerHTML;
assert.ok(html.includes('Сделать вкуснее')&&html.includes('Убрать из блюда'));
assert.ok(html.includes('type="checkbox"')); // optional max=1 can be deselected
run('openProduct(products[1])');
assert.ok(nodes.get('#modalRoot').innerHTML.includes('type="radio"'));
run("stoppedProductIds={apple:true}");
assert.equal(run('productIsAvailable(products[1])'),false); // all required flavours unavailable
run('stoppedProductIds={food:true}');
assert.equal(run('productIsAvailable(products[0])'),false); // case-insensitive IDs
run('stoppedProductIds={};selectedProduct=products[0]');
const inputs=[{checked:true,type:'checkbox',value:'cheese',dataset:{price:'200',group:'extras',name:'Сыр'}},{checked:false,type:'checkbox',value:'omit',dataset:{price:'0',group:'extras',name:'Без огурцов'}}];
const group={dataset:{min:'0',max:'1',name:'Допы'},querySelectorAll:s=>s.includes(':checked')?inputs.filter(i=>i.checked):inputs};
document.querySelectorAll=s=>s==='.modGroup'?[group]:s==='.modInput:checked'?inputs.filter(i=>i.checked):[];
run('updateProductButton()');
assert.match(nodes.get('#confirmProduct').textContent,/1\s200/);
assert.equal(inputs[1].disabled,true);
inputs[0].checked=false;run('updateProductButton()');
assert.equal(inputs[1].disabled,false);
group.dataset.min='1';run('updateProductButton()');
assert.equal(nodes.get('#confirmProduct').disabled,true);
assert.match(nodes.get('#productValidation').textContent,/Выберите 1/);
document.querySelectorAll=()=>[];
run('paintCategories=()=>{};paintMenu=()=>{};updateCart=()=>{};refreshCardActions=()=>{};closeModal=()=>{selectedProduct=null};');
run("cart=[{productId:'food',itemId:'FOOD',modifierIds:['CHEESE'],q:1},{productId:'drink',itemId:'DRINK',modifierIds:['apple'],q:1}];applyStopList({stoppedProductIds:['cheese']})");
assert.equal(run('cart.length'),1);
assert.equal(run('cart[0].productId'),'drink');
assert.match(nodes.get('#cartNotice').textContent,/закончились/);

(async()=>{
  // A delayed response for the old point must not overwrite the new point.
  const pending=[];
  ctx.fetch=url=>new Promise(resolve=>pending.push({url,resolve}));
  run("fulfillment={mode:'pickup',value:'Арай, 1А'}");
  const old=run('loadMenu()');
  run("fulfillment={mode:'pickup',value:'Республика, 4'}");
  const current=run('loadMenu()');
  const respond=(i,data)=>pending[i].resolve({ok:true,json:async()=>({success:true,...data})});
  respond(2,{categories:[],products:[{id:'new',itemId:'new'}]});respond(3,{stoppedProductIds:['NEW-STOP']});await current;
  respond(0,{categories:[],products:[{id:'old',itemId:'old'}]});respond(1,{stoppedProductIds:['OLD-STOP']});await old;
  assert.equal(run('products[0].id'),'new');
  assert.equal(run('isStoppedProductId("new-stop")'),true);
  assert.equal(run('isStoppedProductId("old-stop")'),false);
  assert.equal(timers.at(-1).ms,60000);
  // A pending polling response also belongs only to its starting point.
  const poll=run('loadStopList()');run('menuVersion++');
  respond(4,{stoppedProductIds:['OLD-STOP']});await poll;
  assert.equal(run('isStoppedProductId("old-stop")'),false);
  console.log('PASS: modifier split, prices, optional deselection, limits, required flavours, stop filtering, point URLs, stale menu/stop responses, 60-second polling');
})().catch(e=>{console.error(e);process.exitCode=1});

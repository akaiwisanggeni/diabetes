/* =========================================================
   PANDUAN DIABETES — MULTI FOOD CARBOHYDRATE CALCULATOR
   Uses carb_foods fields:
   - carbs_per_100g
   - serving_size (grams represented by 1 practical unit)
   - serving_unit (user-facing unit)
   ========================================================= */

(function () {
  function esc(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(value ?? ''));
    return String(value ?? '').replace(/[&<>'"]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]; });
  }
  function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  function fmt(value) { if (typeof formatNumber === 'function') return formatNumber(value); return Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 }); }
  function carbPerUnit(food) { return (num(food.serving_size) / 100) * num(food.carbs_per_100g); }

  function setupMultiCarbCalculator() {
    const form = document.querySelector('#carb-calculator-form');
    if (!form) return;
    let rows = [], rowId = 0;
    form.innerHTML = `<div id="mpd-carb-rows"></div><button type="button" id="mpd-carb-add" class="primary-btn" style="margin-top:12px;">+ Tambah Makanan</button>`;
    const rowsEl = form.querySelector('#mpd-carb-rows'), addBtn = form.querySelector('#mpd-carb-add');
    function totalCarbs() { return rows.reduce(function (sum,row) { const food=row.food, amount=num(row.amount); return sum+(food ? amount*carbPerUnit(food):0); },0); }
    function updateTotal() { const result=document.querySelector('#carb-result'); if(result) result.textContent=`${fmt(totalCarbs())} g`; }
    function renderResults(row,query) {
      const q=String(query||'').trim().toLocaleLowerCase('id-ID'), results=row.el.querySelector('.mpd-carb-results'); if(!results)return;
      const source=Array.isArray(window.carbFoods)?window.carbFoods:(typeof carbFoods!=='undefined'?carbFoods:[]);
      const matches=source.filter(function(food){return !q||String(food.name||'').toLocaleLowerCase('id-ID').includes(q);}).sort(function(a,b){const an=String(a.name||'').toLocaleLowerCase('id-ID'),bn=String(b.name||'').toLocaleLowerCase('id-ID');if(q){const as=an.startsWith(q)?0:1,bs=bn.startsWith(q)?0:1;if(as!==bs)return as-bs;}return an.localeCompare(bn,'id-ID');}).slice(0,40);
      results.innerHTML=matches.length?matches.map(function(food){const perUnit=carbPerUnit(food);return `<button type="button" class="mpd-carb-result-item" data-food-id="${esc(food.name)}"><strong>${esc(food.name)}</strong><span>${esc(food.serving_unit||'porsi')} · ${fmt(perUnit)} g karbo / 1 ${esc(food.serving_unit||'porsi')}</span></button>`;}).join(''):'<div class="mpd-carb-empty">Makanan tidak ditemukan.</div>';
      results.style.display='block';
      results.querySelectorAll('.mpd-carb-result-item').forEach(function(button){button.addEventListener('click',function(){const source=Array.isArray(window.carbFoods)?window.carbFoods:(typeof carbFoods!=='undefined'?carbFoods:[]),food=source.find(function(item){return item.name===button.dataset.foodId;});if(!food)return;row.food=food;row.amount=row.amount||1;row.el.querySelector('.mpd-carb-search').value=food.name;row.el.querySelector('.mpd-carb-unit').textContent=food.serving_unit||'porsi';row.el.querySelector('.mpd-carb-unit-info').textContent=`1 ${food.serving_unit||'porsi'} = ${fmt(carbPerUnit(food))} g karbohidrat`;row.el.querySelector('.mpd-carb-item-total').textContent=`${fmt(num(row.amount)*carbPerUnit(food))} g`;results.style.display='none';updateTotal();});});
    }
    function addRow(){
      const id=++rowId,wrapper=document.createElement('div'); wrapper.className='mpd-carb-row'; wrapper.dataset.rowId=String(id);
      wrapper.innerHTML=`<div class="mpd-carb-row-head"><strong>Makanan ${rows.length+1}</strong><button type="button" class="mpd-carb-remove" aria-label="Hapus makanan">Hapus</button></div><label>Pilih Makanan</label><div class="mpd-carb-search-wrap"><input class="mpd-carb-search" type="search" autocomplete="off" placeholder="Cari makanan, misalnya nasi"><div class="mpd-carb-results"></div></div><div class="mpd-carb-amount-line"><div><label>Jumlah</label><input class="mpd-carb-amount" type="number" min="0" step="0.1" value="1" inputmode="decimal"></div><div class="mpd-carb-unit-box"><label>Satuan</label><div class="mpd-carb-unit">—</div></div></div><div class="mpd-carb-unit-info">Pilih makanan untuk melihat satuannya.</div><div class="mpd-carb-item-total-row"><span>Karbohidrat</span><strong class="mpd-carb-item-total">0 g</strong></div>`;
      rowsEl.appendChild(wrapper); const row={id:id,el:wrapper,food:null,amount:1}; rows.push(row); const search=wrapper.querySelector('.mpd-carb-search'),amount=wrapper.querySelector('.mpd-carb-amount');
      search.addEventListener('input',function(){renderResults(row,search.value);}); search.addEventListener('focus',function(){renderResults(row,search.value);}); amount.addEventListener('input',function(){row.amount=num(amount.value);wrapper.querySelector('.mpd-carb-item-total').textContent=row.food?`${fmt(row.amount*carbPerUnit(row.food))} g`:'0 g';updateTotal();});
      wrapper.querySelector('.mpd-carb-remove').addEventListener('click',function(){row.el.remove();rows=rows.filter(function(item){return item.id!==row.id;});rows.forEach(function(item,index){const title=item.el.querySelector('.mpd-carb-row-head strong');if(title)title.textContent=`Makanan ${index+1}`;});if(!rows.length)addRow();updateTotal();});
    }
    addBtn.addEventListener('click',addRow); addRow(); updateTotal();
    const style=document.createElement('style'); style.id='mpd-multi-carb-style'; style.textContent=`#mpd-carb-rows{display:flex;flex-direction:column;gap:14px}.mpd-carb-row{padding:14px;border:1px solid #e3e9e4;border-radius:16px;background:#fbfdfb}.mpd-carb-row-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;color:#176949}.mpd-carb-remove{border:0;background:transparent;color:#a24d4d;font-size:12px;font-weight:700;cursor:pointer}.mpd-carb-search-wrap{position:relative}.mpd-carb-search{width:100%;box-sizing:border-box}.mpd-carb-results{display:none;position:absolute;z-index:20;left:0;right:0;top:calc(100% + 5px);max-height:220px;overflow:auto;background:#fff;border:1px solid #e0e7e1;border-radius:12px;box-shadow:0 8px 22px rgba(0,0,0,.10)}.mpd-carb-result-item{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #eef1ef;background:#fff;padding:11px 12px;cursor:pointer}.mpd-carb-result-item strong,.mpd-carb-result-item span{display:block}.mpd-carb-result-item span{margin-top:3px;font-size:11px;color:#718078}.mpd-carb-empty{padding:13px;color:#777;font-size:12px}.mpd-carb-amount-line{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.mpd-carb-unit-box{min-width:0}.mpd-carb-unit{height:44px;box-sizing:border-box;display:flex;align-items:center;padding:0 13px;border:1px solid #dfe6df;border-radius:10px;background:#f5f8f5;color:#176949;font-weight:700}.mpd-carb-unit-info{margin-top:8px;font-size:11px;color:#718078}.mpd-carb-item-total-row{display:flex;justify-content:space-between;align-items:center;margin-top:11px;padding-top:10px;border-top:1px solid #e8eee9;font-size:13px;color:#56645b}.mpd-carb-item-total-row strong{color:#176949;font-size:15px}#mpd-carb-add{width:100%}`; document.head.appendChild(style);
  }
  window.addEventListener('DOMContentLoaded',function(){setupMultiCarbCalculator();});
})();

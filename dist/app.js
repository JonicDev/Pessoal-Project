(function(){
  'use strict';

  /* ================= constantes ================= */
  var K = {acc:'mc:accounts', data:'mc:data:', last:'mc:last', sync:'mc:sync:', lsync:'mc:lastsync'};
  var SYNC_SQL = "-- Meu caderno · sincronização entre aparelhos\n-- Cole tudo no \"SQL Editor\" do Supabase e clique em Run.\n\ncreate table if not exists public.mc_vaults (\n  vid        text primary key,\n  token_hash text not null,\n  rev        bigint not null default 1,\n  blob       jsonb not null,\n  updated_at timestamptz not null default now()\n);\n\nalter table public.mc_vaults enable row level security;\nrevoke all on table public.mc_vaults from anon, authenticated;\n\ncreate or replace function public.mc_get(p_vid text)\nreturns jsonb\nlanguage sql\nsecurity definer\nset search_path = public\nas $$\n  select jsonb_build_object('rev', rev, 'blob', blob)\n  from public.mc_vaults\n  where vid = p_vid;\n$$;\n\ncreate or replace function public.mc_put(p_vid text, p_token text, p_blob jsonb, p_base_rev bigint)\nreturns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = public\nas $$\ndeclare\n  cur public.mc_vaults%rowtype;\n  th  text := encode(sha256(convert_to(p_token, 'utf8')), 'hex');\nbegin\n  select * into cur from public.mc_vaults where vid = p_vid for update;\n  if not found then\n    if p_base_rev <> 0 then\n      return jsonb_build_object('ok', false, 'rev', 0);\n    end if;\n    insert into public.mc_vaults (vid, token_hash, rev, blob) values (p_vid, th, 1, p_blob);\n    return jsonb_build_object('ok', true, 'rev', 1);\n  end if;\n  if cur.token_hash <> th then\n    return jsonb_build_object('ok', false, 'error', 'auth');\n  end if;\n  if cur.rev <> p_base_rev then\n    return jsonb_build_object('ok', false, 'rev', cur.rev);\n  end if;\n  update public.mc_vaults\n     set blob = p_blob, rev = cur.rev + 1, updated_at = now()\n   where vid = p_vid;\n  return jsonb_build_object('ok', true, 'rev', cur.rev + 1);\nend;\n$$;\n\ncreate or replace function public.mc_delete(p_vid text, p_token text)\nreturns boolean\nlanguage plpgsql\nsecurity definer\nset search_path = public\nas $$\ndeclare\n  n int;\nbegin\n  delete from public.mc_vaults\n   where vid = p_vid\n     and token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex');\n  get diagnostics n = row_count;\n  return n > 0;\nend;\n$$;\n\nrevoke all on function public.mc_get(text) from public;\nrevoke all on function public.mc_put(text, text, jsonb, bigint) from public;\nrevoke all on function public.mc_delete(text, text) from public;\ngrant execute on function public.mc_get(text) to anon, authenticated;\ngrant execute on function public.mc_put(text, text, jsonb, bigint) to anon, authenticated;\ngrant execute on function public.mc_delete(text, text) to anon, authenticated;\n";
  var ITER = 300000;
  var AREAS = ['Faculdade','Saúde','Lazer','Finanças','Geral'];
  var CATS = ['Alimentação','Transporte','Faculdade','Moradia','Lazer','Saúde','Salário/Bolsa','Outros'];
  var KINDS = ['Prova','Trabalho','Entrega','Leitura','Outro'];
  var ACCT_KINDS = [['Caixa','ativo'],['Conta corrente','ativo'],['Poupança','ativo'],['Investimentos','ativo'],['Carteira digital','ativo'],['Outro ativo','ativo'],['Cartão de crédito','passivo'],['Empréstimo','passivo'],['Financiamento','passivo'],['Outro passivo','passivo']];
  var NAMES = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  var ORDER = [1,2,3,4,5,6,0];
  var BRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
  var NUM = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
  var BRL0 = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:0,maximumFractionDigits:2});

  function svg(p){ return '<svg viewBox="0 0 24 24" aria-hidden="true">'+p+'</svg>'; }
  var ICON = {
    hoje: svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.4"/>'),
    tarefas: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>'),
    palavra: svg('<path d="M12 6.5C10 5 7 4.5 4 4.5v14c3 0 6 .5 8 2 2-1.5 5-2 8-2v-14c-3 0-6 .5-8 2z"/><path d="M12 6.5v14"/>'),
    habitos: svg('<path d="M4 12a8 8 0 0113.7-5.6L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 01-13.7 5.6L4 16"/><path d="M4 20v-4h4"/>'),
    fac: svg('<path d="M3 9l9-5 9 5-9 5-9-5z"/><path d="M7 11.5V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5"/>'),
    fin: svg('<path d="M4 7h14a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V7z"/><path d="M4 7l11-3v3"/><circle cx="16" cy="13.5" r="1"/>'),
    metas: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>'),
    menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>')
  };
  var TABS = [['hoje','Geral'],['palavra','Palavra'],['tarefas','Tarefas'],['habitos','Hábitos'],['fac','Faculdade'],['fin','Finanças']];
  function empty(ic, txt){ return '<div class="empty">'+ICON[ic]+'<div>'+txt+'</div></div>'; }

  /* ================= utilidades ================= */
  function $(s){ return document.querySelector(s); }
  function esc(s){ return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function uid(){ return Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-3); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function today(){ return ymd(new Date()); }
  function parse(s){ var p=s.split('-').map(Number); return new Date(p[0],p[1]-1,p[2]); }
  function addDays(d,n){ var r=new Date(d.getTime()); r.setDate(r.getDate()+n); return r; }
  function daysUntil(s){ return Math.round((parse(s)-parse(today()))/86400000); }
  function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
  function shortDate(s){ return parse(s).toLocaleDateString('pt-BR',{day:'numeric',month:'short'}).replace('.',''); }
  function dueLabel(s){
    var n = daysUntil(s);
    if(n===0) return 'hoje'; if(n===1) return 'amanhã'; if(n>1) return 'em '+n+' dias';
    if(n===-1) return 'ontem'; return 'atrasado '+(-n)+' dias';
  }
  function dueClass(s){ var n=daysUntil(s); return n<0?'over':(n<=2?'soon':'muted'); }
  function parseMoney(v){
    v = String(v).trim().replace(/[R$\s]/g,'');
    if(v.indexOf(',')>-1) v = v.replace(/\./g,'').replace(',','.');
    var n = parseFloat(v); return isFinite(n)?n:NaN;
  }
  function validDay(s){ return /^\d{4}-\d{2}-\d{2}$/.test(s) && +s.slice(0,4)>=2000 && +s.slice(0,4)<=2099; }
  function numStr(n){ return String(n).replace('.',','); }
  function opts(list, sel){ return list.map(function(a){return '<option'+(a===sel?' selected':'')+'>'+esc(a)+'</option>';}).join(''); }

  /* ================= dados ================= */
  function blank(){ return {v:3,tasks:[],courses:[],items:[],goals:[],habits:[],tx:[],words:[],accounts:[]}; }
  function normalize(s){
    s = Object.assign(blank(), (s && typeof s==='object') ? s : {});
    s.v = 3;
    ['tasks','courses','items','goals','habits','tx','words','accounts'].forEach(function(k){
      if(!Array.isArray(s[k])) s[k] = [];
      s[k] = s[k].filter(function(o){ return o && typeof o==='object'; });
      s[k].forEach(function(o){ if(!o.id) o.id = uid(); });
    });
    var all = [0,1,2,3,4,5,6];
    s.tasks = s.tasks.filter(function(t){ return typeof t.text==='string'; });
    s.courses = s.courses.filter(function(c){ return typeof c.name==='string'; });
    s.items = s.items.filter(function(i){ return typeof i.title==='string' && typeof i.date==='string'; });
    s.tx = s.tx.filter(function(t){ return typeof t.date==='string' && typeof t.amount==='number'; });
    s.habits = s.habits.filter(function(h){ return typeof h.name==='string'; });
    s.goals = s.goals.filter(function(g){ return typeof g.name==='string' && typeof g.target==='number'; });
    s.words = s.words.filter(function(w){ return typeof w.date==='string' && (typeof w.ref==='string' || typeof w.text==='string'); });
    s.words.forEach(function(w){ ['ref','text','note'].forEach(function(f){ if(typeof w[f]!=='string') w[f]=''; }); });
    s.tasks.forEach(function(t){ t.done=!!t.done; if(typeof t.area!=='string') t.area='Geral'; if(typeof t.date!=='string') t.date=''; if(!PRIO[t.prio]) t.prio=''; if(typeof t.course!=='string') t.course=''; });
    s.items.forEach(function(i){ i.done=!!i.done; if(typeof i.kind!=='string') i.kind='Outro'; if(typeof i.course!=='string') i.course=''; });
    s.tx.forEach(function(t){ if(t.type!=='in' && t.type!=='transfer') t.type='out'; if(typeof t.cat!=='string') t.cat='Outros'; if(typeof t.desc!=='string') t.desc=''; if(typeof t.account!=='string') t.account=''; if(typeof t.to!=='string') t.to=''; t.planned = !!t.planned; });
    s.goals.forEach(function(g){ if(typeof g.due!=='string') g.due=''; });
    s.accounts = s.accounts.filter(function(a){ return typeof a.name==='string'; });
    s.accounts.forEach(function(a){
      if(typeof a.kind!=='string') a.kind='Outro ativo';
      var k = ACCT_KINDS.filter(function(x){return x[0]===a.kind;})[0];
      a.cls = a.cls==='passivo' ? 'passivo' : (k ? k[1] : 'ativo');
      if(typeof a.opening!=='number' || !isFinite(a.opening)) a.opening = 0;
    });
    s.habits.forEach(function(h){
      if(!Array.isArray(h.sched) || !h.sched.length) h.sched = all.slice();
      if(!Array.isArray(h.days)) h.days = [];
      if(typeof h.area!=='string') h.area='Geral';
      if(typeof h.created!=='string') h.created='';
    });
    s.goals.forEach(function(g){
      if(typeof g.current!=='number') g.current=0;
      if(typeof g.area!=='string') g.area='Geral';
      if(typeof g.unit!=='string') g.unit='';
      if(!(g.step>0)) g.step=1;
      if(typeof g.link!=='string') g.link='';
      if(typeof g.base!=='number' || !isFinite(g.base)) g.base=0;
    });
    return s;
  }

  /* ================= estado da interface ================= */
  var state = normalize();
  var session = null;           // {id, name, key}
  var accounts = [];
  var authMode = 'create', authTarget = null, authError = '', showForgot = false;
  var taskTab = 'hoje', taskPrio = '', taskGroup = 'data', filtersOpen = false, qf = false;
  var PRIO = {alta:'Alta', media:'Média', baixa:'Baixa'}, PRANK = {alta:0, media:1, baixa:2};
  var tab = 'hoje', areaFilter = '', selDate = today(), weekOffset = 0, wordDate = today();
  var finMonth = today().slice(0,7), lastTxType = 'out', finView = 'resumo', acctView = '', acctPeriod = 'all', finDay = '', finPeriod = 'mes', habWeek = 0, facCourse = '', facMonth = today().slice(0,7), facDay = '', fold = {res:false, mov:false}, closedDays = {};
  var editing = null;
  var statusText = '';
  var saveTimer = null, saving = false, dirty = false;
  var undoSnap = null, toastTimer = null;
  var cryptoOk = !!(window.crypto && window.crypto.subtle);
  var syncRec = null, syncing = false, syncAgain = false, syncTimer = null, syncLast = '', syncErr = '';

  var SCALES = [['12.5','Mínimo'],['14','Pequeno'],['16','Padrão']];
  function applyScale(){
    var v = null; try{ v = localStorage.getItem('mc:fontpx'); }catch(e){}
    document.documentElement.style.fontSize = (v && isFinite(+v) && +v>=10 && +v<=22) ? (+v)+'px' : '';
  }
  function curScale(){ return parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16; }
  function scaleBlock(){
    var cur = curScale();
    return '<div class="full"><div class="dl-label">Tamanho do app</div><div class="chips">'
      + SCALES.map(function(s){ return '<button class="chip" data-act="setScale" data-v="'+s[0]+'" aria-pressed="'+(Math.abs(cur-(+s[0]))<0.3)+'">'+s[1]+'</button>'; }).join('')
      + '</div></div>';
  }
  function inArea(a){ return tab==='hoje' || !areaFilter || a===areaFilter; }
  function byId(arr,id){ return arr.filter(function(x){return x.id===id;})[0]; }
  function courseName(id){ var c = byId(state.courses,id); return c ? c.name : ''; }

  /* ================= criptografia ================= */
  var enc = new TextEncoder(), dec = new TextDecoder();
  function b64(buf){ var a=new Uint8Array(buf), s=''; for(var i=0;i<a.length;i++) s+=String.fromCharCode(a[i]); return btoa(s); }
  function unb64(s){ var bin=atob(s), a=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a; }
  async function deriveKey(pw, salt, iter){
    var base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt:salt,iterations:iter,hash:'SHA-256'}, base, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
  }
  async function sealBox(key, obj){
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await crypto.subtle.encrypt({name:'AES-GCM',iv:iv}, key, enc.encode(JSON.stringify(obj)));
    return {iv:b64(iv), ct:b64(ct)};
  }
  async function openBox(key, box){
    var pt = await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(box.iv)}, key, unb64(box.ct));
    return JSON.parse(dec.decode(pt));
  }

  /* IndexedDB: guarda a chave (não exportável) para "manter conectado" */
  function idb(){
    return new Promise(function(res,rej){
      var r = indexedDB.open('meu-caderno',1);
      r.onupgradeneeded = function(){ r.result.createObjectStore('s'); };
      r.onsuccess = function(){ res(r.result); };
      r.onerror = function(){ rej(r.error); };
    });
  }
  async function idbSet(k,v){ var db=await idb(); return new Promise(function(res,rej){ var t=db.transaction('s','readwrite'); t.objectStore('s').put(v,k); t.oncomplete=function(){res();}; t.onerror=function(){rej(t.error);}; }); }
  async function idbGet(k){ var db=await idb(); return new Promise(function(res,rej){ var q=db.transaction('s','readonly').objectStore('s').get(k); q.onsuccess=function(){res(q.result);}; q.onerror=function(){rej(q.error);}; }); }
  async function idbDel(k){ var db=await idb(); return new Promise(function(res,rej){ var t=db.transaction('s','readwrite'); t.objectStore('s').delete(k); t.oncomplete=function(){res();}; t.onerror=function(){rej(t.error);}; }); }

  /* ================= contas ================= */
  function loadAccounts(){
    try{ accounts = JSON.parse(localStorage.getItem(K.acc)||'[]'); }catch(e){ accounts = []; }
    if(!Array.isArray(accounts)) accounts = [];
  }
  function saveAccounts(){ localStorage.setItem(K.acc, JSON.stringify(accounts)); }
  function initAuthMode(){
    showForgot = false;
    if(!accounts.length){ authMode='create'; authTarget=null; }
    else if(accounts.length===1){ authMode='login'; authTarget=accounts[0].id; }
    else { authMode='pick'; authTarget=null; }
  }
  function curAcc(){ return session ? byId(accounts, session.id) : null; }

  async function startSession(acc, key, keep){
    var box = null;
    try{ box = JSON.parse(localStorage.getItem(K.data+acc.id)||'null'); }catch(e){}
    var data = box ? await openBox(key, box) : null;
    state = normalize(data);
    session = {id:acc.id, name:acc.name, key:key};
    syncRec = await loadSyncRec(acc.id, key); syncErr = ''; syncLast = ''; syncing = false;
    try{ localStorage.setItem(K.last, acc.id); }catch(e){}
    try{
      if(keep) await idbSet('session', {id:acc.id, key:key}); else await idbDel('session');
    }catch(e){}
    tab='hoje'; selDate=today(); weekOffset=0; areaFilter=''; authError=''; taskTab='hoje'; taskPrio=''; taskGroup='data'; filtersOpen=false; habWeek=0; facCourse=''; facDay=''; finPeriod='mes';
    statusText = idleStatus();
    if(navigator.storage && navigator.storage.persist){ navigator.storage.persist().catch(function(){}); }
    render();
    if(syncRec) syncNow();
  }

  function authFail(msg){
    authError = msg;
    var m = $('#authErr'); if(m) m.textContent = msg;
  }
  function busy(btn, on, label){ if(!btn) return; btn.disabled = on; btn.textContent = label; }

  async function doLogin(f){
    var acc = byId(accounts, authTarget); if(!acc) return;
    var pw = f.elements.pw.value, keep = f.elements.keep.checked;
    var btn = f.querySelector('button[type="submit"]');
    if(!pw) return authFail('Digite a senha.');
    busy(btn,true,'Entrando…');
    try{
      var key = await deriveKey(pw, unb64(acc.salt), acc.iter);
      var ok = false;
      try{ ok = (await openBox(key, acc.check))==='ok'; }catch(e){ ok = false; }
      if(!ok){ busy(btn,false,'Entrar'); return authFail('Senha incorreta.'); }
      await startSession(acc, key, keep);
    }catch(e){
      busy(btn,false,'Entrar');
      authFail('Não foi possível entrar. Os dados desta conta podem estar corrompidos.');
    }
  }

  async function doCreate(f){
    var name = f.elements.name.value.trim(), pw = f.elements.pw.value, pw2 = f.elements.pw2.value, keep = f.elements.keep.checked;
    var btn = f.querySelector('button[type="submit"]');
    if(name.length<2) return authFail('Use um nome com pelo menos 2 letras.');
    if(accounts.some(function(a){return a.name.toLowerCase()===name.toLowerCase();})) return authFail('Já existe uma conta com esse nome.');
    if(pw.length<6) return authFail('A senha precisa ter pelo menos 6 caracteres.');
    if(pw!==pw2) return authFail('As senhas não coincidem.');
    busy(btn,true,'Criando…');
    try{
      var salt = crypto.getRandomValues(new Uint8Array(16));
      var key = await deriveKey(pw, salt, ITER);
      var acc = {id:uid(), name:name, salt:b64(salt), iter:ITER, check:await sealBox(key,'ok')};
      localStorage.setItem(K.data+acc.id, JSON.stringify(await sealBox(key, blank())));
      accounts.push(acc); saveAccounts();
      await startSession(acc, key, keep);
    }catch(e){
      busy(btn,false,'Criar conta');
      authFail('Não foi possível criar a conta neste navegador.');
    }
  }

  async function logout(){
    clearTimeout(saveTimer);
    if(dirty) await flush();
    if(syncRec){ try{ await Promise.race([syncNow(), new Promise(function(res){ setTimeout(res, 4000); })]); }catch(e){} }
    clearTimeout(syncTimer); syncRec = null; syncing = false; syncAgain = false;
    session = null; state = normalize(); editing = null;
    try{ await idbDel('session'); }catch(e){}
    closeSheet(); closeMenu(); hideToast(); undoSnap = null; authError = '';
    initAuthMode(); render();
  }

  async function verifyPw(acc, pw){
    try{
      var key = await deriveKey(pw, unb64(acc.salt), acc.iter);
      return (await openBox(key, acc.check))==='ok' ? key : null;
    }catch(e){ return null; }
  }
  function sheetFail(msg){ var m=$('#sheetErr'); if(m) m.textContent=msg; }

  async function savePw(){
    var acc = curAcc(); if(!acc) return;
    if(syncRec) return sheetFail('Desative a sincronização antes de trocar a senha (e ative de novo depois).');
    var cur = $('#pwCur').value, n1 = $('#pwNew').value, n2 = $('#pwNew2').value;
    var btn = $('#sheet button[data-act="savePw"]');
    if(!cur) return sheetFail('Digite a senha atual.');
    if(n1.length<6) return sheetFail('A nova senha precisa ter pelo menos 6 caracteres.');
    if(n1!==n2) return sheetFail('As senhas novas não coincidem.');
    busy(btn,true,'Alterando…');
    if(!(await verifyPw(acc, cur))){ busy(btn,false,'Alterar senha'); return sheetFail('Senha atual incorreta.'); }
    try{
      clearTimeout(saveTimer);
      while(saving) await new Promise(function(r){ setTimeout(r,50); });
      var salt = crypto.getRandomValues(new Uint8Array(16));
      var key = await deriveKey(n1, salt, ITER);
      var check = await sealBox(key,'ok');
      var data = await sealBox(key, state);
      localStorage.setItem(K.data+acc.id, JSON.stringify(data));
      acc.salt = b64(salt); acc.iter = ITER; acc.check = check; saveAccounts();
      session.key = key;
      try{ var s = await idbGet('session'); if(s && s.id===acc.id) await idbSet('session',{id:acc.id,key:key}); }catch(e){}
      closeSheet(); toast('Senha alterada.');
    }catch(e){ busy(btn,false,'Alterar senha'); sheetFail('Não foi possível alterar a senha.'); }
  }

  async function confirmDel(){
    var acc = curAcc(); if(!acc) return;
    var pw = $('#delPw').value;
    if(!pw) return sheetFail('Digite a senha para confirmar.');
    if(!(await verifyPw(acc, pw))) return sheetFail('Senha incorreta.');
    clearTimeout(saveTimer); dirty = false;
    try{ localStorage.removeItem(K.data+acc.id); }catch(e){}
    accounts = accounts.filter(function(a){return a.id!==acc.id;}); saveAccounts();
    try{ localStorage.removeItem(K.sync+acc.id); }catch(e){}
    clearTimeout(syncTimer); syncRec = null; syncing = false;
    session = null; state = normalize(); editing = null;
    try{ await idbDel('session'); }catch(e){}
    closeSheet(); hideToast(); undoSnap = null; initAuthMode(); render();
  }

  function eraseAccount(id){
    if(!window.confirm('Apagar esta conta e todos os dados dela neste aparelho? Isso não pode ser desfeito.')) return;
    try{ localStorage.removeItem(K.data+id); localStorage.removeItem(K.sync+id); }catch(e){}
    accounts = accounts.filter(function(a){return a.id!==id;}); saveAccounts();
    initAuthMode(); render();
  }

  function exportBackup(){
    var payload = {app:'meu-caderno', v:3, exportedAt:new Date().toISOString(), account:session.name, state:state};
    var blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url; a.download = 'meu-caderno-'+today()+'.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
    toast('Backup exportado.');
  }
  function importBackup(file){
    var r = new FileReader();
    r.onload = function(){
      try{
        var j = JSON.parse(r.result);
        var s = (j && j.state) ? j.state : j;
        var known = ['tasks','habits','items','goals','tx','courses','words','accounts'];
        if(!s || typeof s!=='object' || !known.some(function(k){return Array.isArray(s[k]);})) throw new Error('formato');
        undoSnap = JSON.stringify(state);
        state = normalize(s);
        closeSheet(); commit(); toast('Backup importado.', true);
      }catch(e){ toast('Arquivo de backup inválido.'); }
    };
    r.readAsText(file);
  }

  /* ================= sincronização entre aparelhos ================= */
  var ARRS = ['tasks','courses','items','goals','habits','tx','words','accounts'];
  function hexOf(u){ var s=''; for(var i=0;i<u.length;i++) s += ('0'+u[i].toString(16)).slice(-2); return s; }
  async function deriveSync(name, pw){
    var base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits({name:'PBKDF2', salt:enc.encode('meu-caderno-sync-v1|'+name.trim().toLowerCase()), iterations:ITER, hash:'SHA-256'}, base, 512);
    var u = new Uint8Array(bits);
    return {vid:hexOf(u.slice(0,32)), token:hexOf(u.slice(32,64))};
  }
  function cleanUrl(u){ return String(u||'').trim().replace(/\/+$/,'').replace(/\/rest\/v1$/,''); }
  function urlOk(u){ return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u); }
  function ser(s){ return JSON.stringify(normalize(JSON.parse(JSON.stringify(s)))); }
  function lastSyncCfg(){ try{ return JSON.parse(localStorage.getItem(K.lsync)||'{}') || {}; }catch(e){ return {}; } }
  function hhmm(){ var d = new Date(); return pad(d.getHours())+':'+pad(d.getMinutes()); }
  async function rpc(rec, fn, args){
    var hd = {'Content-Type':'application/json', 'apikey':rec.anon};
    if(rec.anon.indexOf('eyJ')===0) hd['Authorization'] = 'Bearer '+rec.anon;
    var res = await fetch(rec.url+'/rest/v1/rpc/'+fn, {method:'POST', headers:hd, body:JSON.stringify(args)});
    if(!res.ok){ var er = new Error('http '+res.status); er.status = res.status; throw er; }
    return res.json();
  }
  function syncMsg(e){
    if(e && e.code==='auth') return 'Sincronização recusada: senha ou chave não conferem';
    if(e && e.status===404) return 'O servidor ainda não tem o script SQL';
    if(e && (e.status===401 || e.status===403)) return 'Chave do servidor recusada';
    if(e && e.status) return 'Servidor respondeu com erro '+e.status;
    if(e && e.name==='OperationError') return 'Não foi possível abrir os dados da nuvem';
    return 'Sem conexão · sincroniza depois';
  }
  async function saveSyncRec(id, key, rec){
    if(!rec){ try{ localStorage.removeItem(K.sync+id); }catch(e){} return; }
    localStorage.setItem(K.sync+id, JSON.stringify(await sealBox(key, rec)));
  }
  async function loadSyncRec(id, key){
    try{ var b = JSON.parse(localStorage.getItem(K.sync+id)||'null'); return b ? await openBox(key, b) : null; }catch(e){ return null; }
  }
  function mapById(arr){ var m = {}; (arr||[]).forEach(function(o){ m[o.id] = o; }); return m; }
  /* mescla por item: aplica o que mudou aqui (em relação à última sincronização) por cima do que está na nuvem */
  function merge(base, local, remote){
    var out = normalize(JSON.parse(JSON.stringify(remote)));
    ARRS.forEach(function(k){
      var B = mapById(base[k]), L = mapById(local[k]), R = mapById(out[k]);
      var order = (out[k]||[]).map(function(o){ return o.id; });
      Object.keys(L).forEach(function(id){
        if(!B[id] || JSON.stringify(B[id])!==JSON.stringify(L[id])){
          if(!R[id]) order.push(id);
          R[id] = JSON.parse(JSON.stringify(L[id]));
        }
      });
      Object.keys(B).forEach(function(id){ if(!L[id]) delete R[id]; });
      out[k] = order.filter(function(id){ return R[id]; }).map(function(id){ return R[id]; });
    });
    return normalize(out);
  }
  function syncLine(){
    if(syncing) return 'Sincronizando…';
    if(syncErr) return syncErr;
    return syncLast ? 'Última sincronização às '+syncLast : 'Ainda não sincronizado';
  }
  function idleStatus(){
    if(!syncRec) return 'Só neste aparelho · sem sincronização';
    if(syncErr) return syncErr;
    return syncLast ? 'Sincronizado às '+syncLast : 'Salvo · sincroniza em breve';
  }
  function syncSoon(){ if(!syncRec) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 2500); }
  function applyMerged(sess, merged, snapSer, snap){
    if(session!==sess) return;
    if(ser(merged)===snapSer) return;
    var curJSON = JSON.stringify(state);
    var next = (ser(JSON.parse(curJSON))===snapSer) ? merged : merge(snap, JSON.parse(curJSON), merged);
    state = normalize(next);
    persist(); render();
  }
  async function syncNow(){
    if(!session || !syncRec) return;
    if(syncing){ syncAgain = true; return; }
    if(typeof navigator!=='undefined' && navigator.onLine===false){ syncErr = 'Sem conexão · sincroniza depois'; setStatus(idleStatus()); return; }
    syncing = true; syncErr = ''; setStatus('Sincronizando…');
    var sess = session, rec = syncRec, done = false;
    try{
      for(var tries=0; tries<4 && !done; tries++){
        var snapJSON = JSON.stringify(state), snap = JSON.parse(snapJSON), snapSer = ser(snap);
        var remote = await rpc(rec, 'mc_get', {p_vid:rec.vid});
        var merged = normalize(JSON.parse(snapJSON)), remoteSer = '', baseRev = 0;
        if(remote){
          baseRev = remote.rev;
          var rs = normalize(await openBox(sess.key, remote.blob.data));
          remoteSer = ser(rs);
          if(remote.rev !== rec.rev) merged = merge(rec.base ? JSON.parse(rec.base) : blank(), snap, rs);
        }
        var mergedSer = ser(merged);
        if(remote && mergedSer===remoteSer){
          rec.rev = remote.rev; rec.base = mergedSer; applyMerged(sess, merged, snapSer, snap); done = true; break;
        }
        var acc = byId(accounts, sess.id);
        var blob = {v:1, salt:acc.salt, iter:acc.iter, check:acc.check, data:await sealBox(sess.key, merged)};
        var res = await rpc(rec, 'mc_put', {p_vid:rec.vid, p_token:rec.token, p_blob:blob, p_base_rev:baseRev});
        if(res && res.ok){ rec.rev = res.rev; rec.base = mergedSer; applyMerged(sess, merged, snapSer, snap); done = true; }
        else if(res && res.error==='auth'){ var ae = new Error('auth'); ae.code = 'auth'; throw ae; }
      }
      if(syncRec===rec) await saveSyncRec(sess.id, sess.key, rec);
      if(done) syncLast = hhmm(); else syncErr = 'Conflito persistente · tenta de novo em instantes';
    }catch(e){ syncErr = syncMsg(e); }
    syncing = false;
    if(session===sess) setStatus(idleStatus());
    if(syncAgain){ syncAgain = false; syncSoon(); }
  }

  async function enableSync(){
    var acc = curAcc(); if(!acc) return;
    var url = cleanUrl($('#syUrl').value), anon = $('#syKey').value.trim(), pw = $('#syPw').value;
    var btn = $('#sheet button[data-act="enableSync"]');
    if(!urlOk(url)) return sheetFail('Endereço inválido. Use https://SEU-PROJETO.supabase.co');
    if(anon.length<20) return sheetFail('Cole a chave pública (anon ou publishable) do projeto.');
    if(!pw) return sheetFail('Digite a senha desta conta.');
    busy(btn,true,'Conectando…');
    if(!(await verifyPw(acc, pw))){ busy(btn,false,'Ativar e sincronizar'); return sheetFail('Senha incorreta.'); }
    try{
      var d = await deriveSync(acc.name, pw);
      var rec = {url:url, anon:anon, vid:d.vid, token:d.token, rev:0, base:''};
      var remote = await rpc(rec, 'mc_get', {p_vid:rec.vid});
      if(remote){
        try{ await openBox(session.key, remote.blob.data); }
        catch(e){ busy(btn,false,'Ativar e sincronizar'); return sheetFail('Já existe uma conta sincronizada com esse nome e senha, criada em outro aparelho. Saia da conta aqui e use "Entrar com conta sincronizada".'); }
      }
      syncRec = rec; syncErr = ''; syncLast = '';
      await saveSyncRec(acc.id, session.key, rec);
      try{ localStorage.setItem(K.lsync, JSON.stringify({url:url, anon:anon})); }catch(e){}
      closeSheet(); toast('Sincronização ativada.');
      await syncNow();
    }catch(e){ busy(btn,false,'Ativar e sincronizar'); sheetFail(syncMsg(e)); }
  }
  async function doSyncLogin(f){
    var name = f.elements.name.value.trim(), pw = f.elements.pw.value, url = cleanUrl(f.elements.url.value), anon = f.elements.anon.value.trim(), keep = f.elements.keep.checked;
    var btn = f.querySelector('button[type="submit"]');
    if(name.length<2) return authFail('Digite o nome da conta.');
    if(!pw) return authFail('Digite a senha.');
    if(!urlOk(url)) return authFail('Endereço inválido. Use https://SEU-PROJETO.supabase.co');
    if(anon.length<20) return authFail('Cole a chave pública do projeto.');
    if(accounts.some(function(a){return a.name.toLowerCase()===name.toLowerCase();})) return authFail('Já existe uma conta com esse nome neste aparelho. Entre nela e ative a sincronização.');
    busy(btn,true,'Buscando…');
    try{
      var d = await deriveSync(name, pw);
      var rec = {url:url, anon:anon, vid:d.vid, token:d.token, rev:0, base:''};
      var remote = await rpc(rec, 'mc_get', {p_vid:rec.vid});
      if(!remote || !remote.blob){ busy(btn,false,'Entrar e sincronizar'); return authFail('Nenhuma conta sincronizada com esse nome e senha neste servidor. Confira o nome, a senha e o endereço.'); }
      var b = remote.blob, key = await deriveKey(pw, unb64(b.salt), b.iter), ok = false;
      try{ ok = (await openBox(key, b.check))==='ok'; }catch(e){}
      if(!ok){ busy(btn,false,'Entrar e sincronizar'); return authFail('Senha incorreta para essa conta.'); }
      var st = normalize(await openBox(key, b.data));
      var acc = {id:uid(), name:name, salt:b.salt, iter:b.iter, check:b.check};
      localStorage.setItem(K.data+acc.id, JSON.stringify(await sealBox(key, st)));
      accounts.push(acc); saveAccounts();
      rec.rev = remote.rev; rec.base = ser(st);
      await saveSyncRec(acc.id, key, rec);
      try{ localStorage.setItem(K.lsync, JSON.stringify({url:url, anon:anon})); }catch(e){}
      await startSession(acc, key, keep);
    }catch(e){ busy(btn,false,'Entrar e sincronizar'); authFail(syncMsg(e)); }
  }
  async function syncOff(wipe){
    var rec = syncRec; if(!rec || !session) return;
    if(wipe){
      if(!window.confirm('Apagar a cópia na nuvem? Os dados deste aparelho continuam aqui, mas os outros aparelhos deixam de sincronizar.')) return;
      try{ await rpc(rec, 'mc_delete', {p_vid:rec.vid, p_token:rec.token}); }
      catch(e){ sheetFail(syncMsg(e)); return; }
    }
    syncRec = null; clearTimeout(syncTimer); syncErr = ''; syncLast = '';
    await saveSyncRec(session.id, session.key, null);
    setStatus(idleStatus()); closeSheet();
    toast(wipe ? 'Cópia na nuvem apagada.' : 'Sincronização desativada neste aparelho.');
  }
  function copySql(){
    var ta = $('#sqlText'), b = $('#sheet [data-act="copySql"]');
    var done = function(){ if(b) b.textContent = 'Copiado!'; };
    var fallback = function(){ try{ ta.focus(); ta.select(); document.execCommand('copy'); done(); }catch(e){} };
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(SYNC_SQL).then(done, fallback); } else fallback();
  }

  /* ================= salvamento ================= */
  function setStatus(t){ statusText = t; var s=$('#status'); if(s) s.textContent = t; }
  function persist(){
    if(!session) return;
    dirty = true; setStatus('Salvando…');
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300);
  }
  async function flush(){
    if(!session) return;
    if(saving){ saveTimer = setTimeout(flush, 150); return; }
    saving = true; dirty = false;
    var sess = session;
    try{
      var box = await sealBox(sess.key, state);
      localStorage.setItem(K.data+sess.id, JSON.stringify(box));
      setStatus(idleStatus()); syncSoon();
    }catch(e){ setStatus('Erro ao salvar'); }
    saving = false;
    if(dirty){ clearTimeout(saveTimer); saveTimer = setTimeout(flush, 150); }
  }
  function t0(){ return today(); }
  function commit(){ persist(); render(); }

  /* desfazer */
  function toast(msg, withUndo){
    var t = $('#toast');
    t.innerHTML = '<span>'+esc(msg)+'</span>'+(withUndo?'<button data-act="undo">Desfazer</button>':'');
    t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 6000);
  }
  function hideToast(){ var t=$('#toast'); if(t){ t.hidden = true; t.innerHTML=''; } clearTimeout(toastTimer); }
  function removeWith(msg, fn){
    undoSnap = JSON.stringify(state);
    fn(); commit(); toast(msg, true);
  }

  /* ================= cálculos ================= */
  function dayList(key){
    var wd = parse(key).getDay();
    var hs = state.habits.filter(function(h){return inArea(h.area) && h.sched.indexOf(wd)>-1;});
    var ts = state.tasks.filter(function(t){return inArea(t.area) && t.date===key;});
    var is = inArea('Faculdade') ? state.items.filter(function(i){return i.date===key;}) : [];
    var done = hs.filter(function(h){return h.days.indexOf(key)>-1;}).length
      + ts.filter(function(t){return t.done;}).length
      + is.filter(function(i){return i.done;}).length;
    return {hs:hs, ts:ts, is:is, total:hs.length+ts.length+is.length, done:done};
  }
  function streak(hb){
    var set = new Set(hb.days), d = new Date(), n = 0;
    for(var i=0;i<400;i++){
      if(set.has(ymd(d))) n++;
      else if(hb.sched.indexOf(d.getDay())>-1 && i>0) break;
      d = addDays(d,-1);
    }
    return n;
  }
  function schedLabel(s){
    if(s.length===7) return 'Todos os dias';
    var idx = [];
    ORDER.forEach(function(d,i){ if(s.indexOf(d)>-1) idx.push(i); });
    if(!idx.length) return 'Sem dias';
    var last = idx[idx.length-1];
    if(idx.length>2 && last-idx[0]===idx.length-1) return NAMES[ORDER[idx[0]]]+'–'+NAMES[ORDER[last]];
    return idx.map(function(i){return NAMES[ORDER[i]];}).join(', ');
  }
  function sub(area, extra){
    var p = [];
    if(area && area!=='Geral') p.push(esc(area));
    if(extra) p.push(extra);
    return p.length ? '<div class="small muted">'+p.join(' · ')+'</div>' : '';
  }
  function goalTarget(g){ return (g.unit==='R$' || goalLinked(g)) ? BRL0.format(g.target) : NUM.format(g.target)+(g.unit?' '+esc(g.unit):''); }

  /* ================= componentes ================= */
  /* contas patrimoniais */
  function acctById(id){ return id ? byId(state.accounts, id) : null; }
  function delta(a, t){
    if(t.planned) return 0;
    var liab = a.cls==='passivo';
    if(t.type==='transfer'){
      if(t.account===a.id && t.to!==a.id) return liab ? t.amount : -t.amount;
      if(t.to===a.id && t.account!==a.id) return liab ? -t.amount : t.amount;
      return 0;
    }
    if(t.account!==a.id) return 0;
    var inflow = t.type==='in';
    return liab ? (inflow ? -t.amount : t.amount) : (inflow ? t.amount : -t.amount);
  }
  function periodRange(){
    var y = +finMonth.slice(0,4), m = +finMonth.slice(5,7);
    if(finPeriod==='ano') return [y+'-01-01', y+'-12-31'];
    if(finPeriod==='trim'){ var st = new Date(y,m-3,1); return [st.getFullYear()+'-'+pad(st.getMonth()+1)+'-01', finMonth+'-31']; }
    return [finMonth+'-01', finMonth+'-31'];
  }
  function inPeriod(d){ var rg = periodRange(); return d>=rg[0] && d<=rg[1]; }
  function periodLabel(){
    var y = +finMonth.slice(0,4), m = +finMonth.slice(5,7);
    if(finPeriod==='ano') return String(y);
    var f = function(dt,o){ return cap(dt.toLocaleDateString('pt-BR',o).replace('.','')); };
    if(finPeriod==='trim') return f(new Date(y,m-3,1),{month:'short'})+' – '+f(new Date(y,m-1,1),{month:'short',year:'numeric'});
    return f(new Date(y,m-1,1),{month:'long',year:'numeric'});
  }
  function r2(n){ return Math.round(n*100)/100; }
  function acctBal(a){ var b = a.opening||0; state.tx.forEach(function(t){ b += delta(a,t); }); return r2(b); }
  function netWorth(){
    var A = 0, L = 0;
    state.accounts.forEach(function(a){ var b = acctBal(a); if(a.cls==='passivo') L += b; else A += b; });
    return {A:r2(A), L:r2(L), N:r2(A-L)};
  }
  function acctLedger(a){
    var moves = [];
    state.tx.forEach(function(t,i){ if(!t.planned && (t.account===a.id || t.to===a.id)){ var d = delta(a,t); moves.push({t:t, d:d, i:i}); } });
    moves.sort(function(x,y){ return x.t.date.localeCompare(y.t.date) || x.i-y.i; });
    var run = a.opening||0;
    moves.forEach(function(m){ run = r2(run+m.d); m.bal = run; });
    return moves;
  }
  function txMeta(t){
    var a = acctById(t.account), b = acctById(t.to);
    if(t.type==='transfer') return 'Transferência · '+(a?esc(a.name):'sem conta')+' → '+(b?esc(b.name):'sem conta')+' · '+shortDate(t.date);
    return esc(t.cat)+(a?' · '+esc(a.name):'')+' · '+shortDate(t.date);
  }
  function goalLinked(g){ return g.link==='__net' || !!acctById(g.link); }
  function goalCurrent(g){
    if(g.link==='__net') return r2(netWorth().N - (g.base||0));
    var a = acctById(g.link);
    return a ? r2(acctBal(a) - (g.base||0)) : g.current;
  }
  function goalLinkLabel(g){ if(g.link==='__net') return 'Patrimônio líquido'; var a = acctById(g.link); return a ? 'Saldo de '+a.name : ''; }
  function dayLabel(s){
    var base = cap(parse(s).toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'short'}).replace('.',''));
    if(s===today()) return 'Hoje · '+base;
    if(s===ymd(addDays(new Date(),-1))) return 'Ontem · '+base;
    return base;
  }
  function dayHead(s, amt, good, subtxt, key, closed){
    return '<button class="dayhead" data-act="toggleDay" data-key="'+esc(key)+'" aria-expanded="'+(!closed)+'"><span class="dleft"><strong>'+esc(dayLabel(s))+'</strong>'+(subtxt?'<span class="small muted">'+subtxt+'</span>':'')+'</span>'
      + '<span class="dright">'+(amt===null ? '' : '<span class="dtot '+(good?'':'out')+'">'+(amt>=0?'+':'−')+BRL.format(Math.abs(amt))+'</span>')+'<span class="dchev" aria-hidden="true">›</span></span></button>';
  }
  function dayStrip(has, withNav){
    var y = +finMonth.slice(0,4), m = +finMonth.slice(5,7), last = new Date(y,m,0).getDate(), td = today();
    var label = cap(new Date(y,m-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}));
    var h = '<div class="filterbar"><div class="flabel">Filtrar por dia</div>'
      + (withNav ? '<div class="mnav" style="margin:0.375rem 0 4px"><button class="btn ghost sm" data-act="monthPrev" aria-label="Mês anterior">‹</button><strong>'+esc(label)+'</strong><button class="btn ghost sm" data-act="monthNext" aria-label="Próximo mês">›</button></div>' : '')
      + '<div class="dtools"><button class="chip" data-act="clearDay" aria-pressed="'+(!finDay)+'">Todos os dias</button><button class="chip" data-act="dayToday" aria-pressed="'+(finDay===td)+'">Hoje</button></div>'
      + '<div class="dstrip" id="dstrip" role="group" aria-label="Dias do mês">';
    for(var d=1; d<=last; d++){
      var key = finMonth+'-'+pad(d), wd = NAMES[new Date(y,m-1,d).getDay()];
      h += '<button class="dchip'+(key===td?' today':'')+'" data-act="pickDay" data-date="'+key+'" aria-pressed="'+(finDay===key)+'" aria-label="'+d+' de '+esc(label.split(' ')[0].toLowerCase())+(has[key]?', com lançamentos':'')+'"><span class="n">'+wd+'</span><span class="d">'+d+'</span><i class="dd'+(has[key]?' on':'')+'"></i></button>';
    }
    return h + '</div></div>';
  }
  function dayHas(txs){ var o = {}; txs.forEach(function(t){ o[t.date] = true; }); return o; }
  function acctOptions(sel, withNone){
    return (withNone ? '<option value="">Sem conta</option>' : '')
      + state.accounts.map(function(a){ return '<option value="'+a.id+'"'+(a.id===sel?' selected':'')+'>'+esc(a.name)+'</option>'; }).join('');
  }
  function segBar(){
    var on = function(v){ return v==='resumo' ? finView==='resumo' : finView!=='resumo'; };
    return '<div class="chipbar" role="group" aria-label="Seção de finanças"><button class="chip" data-act="finView" data-v="resumo" aria-pressed="'+on('resumo')+'">Resumo</button><button class="chip" data-act="finView" data-v="contas" aria-pressed="'+on('contas')+'">Contas</button></div>';
  }

  function chipBar(){
    var h = '<div class="chipbar" role="group" aria-label="Filtrar por área"><button class="chip" data-act="setArea" data-area="" aria-pressed="'+(!areaFilter)+'">Todas</button>';
    AREAS.forEach(function(a){
      h += '<button class="chip" data-act="setArea" data-area="'+a+'" aria-pressed="'+(areaFilter===a)+'">'+a+'</button>';
    });
    return h + '</div>';
  }
  function weekDays(){
    var d = new Date(), dow = (d.getDay()+6)%7, out = [];
    d = addDays(d, -dow + weekOffset*7);
    for(var i=0;i<7;i++){ out.push(ymd(d)); d = addDays(d,1); }
    return out;
  }
  function strip(){
    var days = weekDays(), t = today();
    var label = cap(parse(days[3]).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}));
    var h = '<div class="card wide compact"><div class="mnav"><button class="btn ghost sm" data-act="weekPrev" aria-label="Semana anterior">‹</button><strong>'+esc(label)+'</strong><button class="btn ghost sm" data-act="weekNext" aria-label="Próxima semana">›</button></div><div class="wk">';
    days.forEach(function(k){
      var L = dayList(k), d = parse(k);
      h += '<button class="wk-d'+(k===selDate?' sel':'')+(k===t?' today':'')+(L.total&&L.done===L.total?' full':'')+dayCls(L)+'" data-act="selDay" data-date="'+k+'" aria-pressed="'+(k===selDate)+'" aria-label="'+esc(shortDate(k))+(L.ts.length?': '+L.ts.length+(L.ts.length===1?' tarefa':' tarefas'):'')+(L.is.length?', '+L.is.length+(L.is.length===1?' prazo':' prazos'):'')+'"><span class="n">'+NAMES[d.getDay()]+'</span><span class="d">'+d.getDate()+'</span><span class="dots">'+dots(L)+'</span><span class="c">'+(L.total?L.done+'/'+L.total:'')+'</span></button>';
    });
    return h + '</div><div class="legend small muted"><span class="dot t"></span> tarefa<span class="dot p"></span> prazo da faculdade<span class="dot t ok"></span> tudo feito</div></div>';
  }
  function dayCls(L){
    var pt = L.ts.some(function(x){return !x.done;}), pp = L.is.some(function(x){return !x.done;});
    return (pt?' has-t':'') + (pp?' has-p':'') + ((L.ts.length+L.is.length>0 && !pt && !pp)?' all-done':'');
  }
  function dots(L){
    var s = '';
    if(L.ts.length) s += '<i class="dot t'+(L.ts.some(function(x){return !x.done;})?'':' ok')+'"></i>';
    if(L.is.length) s += '<i class="dot p'+(L.is.some(function(x){return !x.done;})?'':' ok')+'"></i>';
    return s;
  }
  function taskMeta(t){
    var m = '';
    if(t.prio && PRIO[t.prio]) m += '<span class="tag p-'+t.prio+'">'+PRIO[t.prio]+'</span>';
    if(t.date) m += '<span class="tag dt '+(t.done?'':dueClass(t.date))+'">'+esc(daysUntil(t.date)>=0 && daysUntil(t.date)<=1 ? dueLabel(t.date) : dueLabel(t.date)+' · '+shortDate(t.date))+'</span>';
    if(t.course && courseName(t.course)) m += '<span class="tag co">'+esc(courseName(t.course))+'</span>';
    m += '<span class="tag ar">'+esc(t.area||'Geral')+'</span>';
    return '<div class="tmeta">'+m+'</div>';
  }
  function taskRow(t){
    return '<div class="row"><input type="checkbox" class="chk" data-act="toggleTask" data-id="'+t.id+'" '+(t.done?'checked':'')+' aria-label="Concluir"><div class="grow tap '+(t.done?'done':'')+'" data-act="edit" data-kind="task" data-id="'+t.id+'">'+esc(t.text)+taskMeta(t)+'</div><button class="x" data-act="delTask" data-id="'+t.id+'" aria-label="Remover">×</button></div>';
  }
  function itemRow(i){
    var c = courseName(i.course);
    return '<div class="row"><input type="checkbox" class="chk" data-act="toggleItem" data-id="'+i.id+'" '+(i.done?'checked':'')+' aria-label="Concluir"><div class="grow tap '+(i.done?'done':'')+'" data-act="edit" data-kind="item" data-id="'+i.id+'">'+esc(i.title)+'<div class="small muted">'+esc(i.kind)+(c?' · '+esc(c):'')+' · '+shortDate(i.date)+'</div></div>'
      + (i.done?'':'<span class="small '+dueClass(i.date)+'">'+dueLabel(i.date)+'</span>')
      + '<button class="x" data-act="delItem" data-id="'+i.id+'" aria-label="Remover">×</button></div>';
  }
  function wordBlock(w, compact){
    return '<div class="wblock"><div class="between" style="align-items:flex-start"><div class="grow tap" data-act="edit" data-kind="word" data-id="'+w.id+'">'
      + (w.ref?'<div class="wref">'+esc(w.ref)+'</div>':'')
      + (w.text?'<div class="verse"><div'+(compact?' class="clamp"':'')+'>'+esc(w.text)+'</div></div>':'')
      + (!compact && w.note?'<div class="wnote small muted">'+esc(w.note)+'</div>':'')
      + '</div><button class="x" data-act="delWord" data-id="'+w.id+'" aria-label="Remover">×</button></div></div>';
  }
  function cta(kind, label){
    return '<div class="cta"><div class="cta-in"><button class="btn block" data-act="openSheet" data-kind="'+kind+'" title="Atalho: tecla N">'+label+'</button><small>Toque em um item para editar.</small></div></div>';
  }

  /* ================= telas ================= */
  function stateIcon(on){ return '<span class="state'+(on?' on':'')+'" role="img" aria-label="'+(on?'Feito':'Pendente')+'"></span>'; }
  function viewRow(kind, o, text, subHtml, on, right){
    return '<div class="row tap" data-act="view" data-kind="'+kind+'" data-id="'+o.id+'">'+stateIcon(on)+'<div class="grow '+(on?'done':'')+'">'+esc(text)+subHtml+'</div>'+(right||'')+'<span class="chev" aria-hidden="true">›</span></div>';
  }
  function emptyAct(ic, txt, label, kind){
    return '<div class="empty">'+ICON[ic]+'<div>'+txt+'</div><button class="btn ghost sm" data-act="openSheet" data-kind="'+kind+'">+ '+label+'</button></div>';
  }
  function statCard(tabKey, ic, big, txt, label, small, cls, bigCls){
    return '<button class="stat" data-tab="'+tabKey+'">'+ICON[ic]+'<span class="sv'+(txt?' txt':'')+(bigCls?' '+bigCls:'')+'">'+esc(big)+'</span><span class="sl'+(cls?' '+cls:'')+'">'+esc(label)+'</span><span class="sl">'+esc(small)+'</span></button>';
  }
  function viewHoje(){
    var t = today(), isToday = selDate===t, L = dayList(selDate);
    var late = state.tasks.filter(function(x){return !x.done && x.date && x.date<t;}).sort(function(a,b){return a.date.localeCompare(b.date);});
    var pend = L.ts.filter(function(x){return !x.done;}), fin = L.ts.filter(function(x){return x.done;});
    var pendN = pend.length + (isToday ? late.length : 0);
    var hDone = L.hs.filter(function(x){return x.days.indexOf(selDate)>-1;}).length;
    var ws = state.words.filter(function(w){return w.date===selDate;});
    var up = state.items.filter(function(i){return !i.done && daysUntil(i.date)>=0;}).sort(function(a,b){return a.date.localeCompare(b.date);})[0];

    var h = '<div class="stats">'
      + statCard('tarefas','tarefas', String(pendN), false, 'Tarefas pendentes', isToday && late.length ? late.length+(late.length===1?' atrasada':' atrasadas') : (L.ts.length ? fin.length+' de '+L.ts.length+(L.ts.length===1?' feita':' feitas') : 'Nenhuma no dia'), isToday && late.length ? 'bad' : '', isToday && late.length ? 'bad' : '')
      + statCard('habitos','habitos', L.hs.length ? Math.round(hDone/L.hs.length*100)+'%' : 'Nenhum', !L.hs.length, 'Hábitos do dia', L.hs.length ? hDone+' de '+plural(L.hs.length,'hábito feito','hábitos feitos') : 'agendado para hoje')
      + statCard('palavra','palavra', ws.length ? 'Registrada' : 'Pendente', true, 'Palavra do dia', ws.length ? (ws[0].ref || 'Reflexão feita') : 'Toque para registrar')
      + statCard('fac','fac', up ? dueLabel(up.date) : 'Nenhum', true, 'Próximo prazo', up ? up.title : 'Sem prazos à vista', '', up && daysUntil(up.date)<=2 ? 'warn' : '')
      + '</div>'
      + '<div class="qa"><button class="btn" data-act="openSheet" data-kind="task">+ Tarefa</button><button class="btn ghost" data-act="openSheet" data-kind="habit">+ Hábito</button><button class="btn ghost" data-act="openSheet" data-kind="word">+ Palavra</button></div>'
      + strip();

    if(isToday && late.length){
      h += '<div class="card wide"><h2>Atrasadas</h2>';
      late.forEach(function(x){ h += viewRow('task', x, x.text, sub(x.area,'<span class="over">'+dueLabel(x.date)+'</span>'), false); });
      h += '</div>';
    }

    h += '<div class="card daycard"><div class="between"><h2>Tarefas do dia</h2><span class="dchd">'+(L.ts.length?'<span class="small muted">'+fin.length+' de '+plural(L.ts.length,'tarefa','tarefas')+'</span><button class="btn ghost sm addb" data-act="openSheet" data-kind="task" aria-label="Adicionar tarefa">+</button>':'')+'</span></div>';
    if(!L.ts.length) h += emptyAct('tarefas','Nenhuma tarefa para '+(isToday?'hoje':'este dia')+'.','Adicionar tarefa','task');
    pend.concat(fin).forEach(function(x){
      h += viewRow('task', x, x.text, sub(x.area, x.date ? '<span class="'+(x.done?'':dueClass(x.date))+'">'+dueLabel(x.date)+'</span>' : ''), x.done);
    });
    h += '</div>';

    h += '<div class="card daycard"><div class="between"><h2>Hábitos do dia</h2><span class="dchd">'+(L.hs.length?'<span class="small muted">'+hDone+' de '+plural(L.hs.length,'hábito','hábitos')+'</span><button class="btn ghost sm addb" data-act="openSheet" data-kind="habit" aria-label="Criar hábito">+</button>':'')+'</span></div>';
    if(!L.hs.length) h += emptyAct('habitos','Nenhum hábito para '+(isToday?'hoje':'este dia')+'.','Criar hábito','habit');
    L.hs.forEach(function(x){ h += viewRow('habit', x, x.name, sub(x.area), x.days.indexOf(selDate)>-1); });
    h += '</div>';

    var upc = [];
    state.tasks.forEach(function(x){ if(!x.done && x.date && daysUntil(x.date)>=0) upc.push({k:'task', o:x, d:x.date}); });
    state.items.forEach(function(i){ if(!i.done && daysUntil(i.date)>=0) upc.push({k:'item', o:i, d:i.date}); });
    upc.sort(function(a,b){return a.d.localeCompare(b.d);});
    h += '<div class="card daycard"><h2>Próximas atividades</h2>';
    if(!upc.length) h += emptyAct('fac','Nada marcado para os próximos dias.','Adicionar prazo','item');
    upc.slice(0,5).forEach(function(u){
      var right = '<span class="small '+dueClass(u.d)+'">'+dueLabel(u.d)+'</span>';
      if(u.k==='task') h += viewRow('task', u.o, u.o.text, sub(u.o.area, esc(shortDate(u.d))), false, right);
      else { var c = courseName(u.o.course); h += viewRow('item', u.o, u.o.title, '<div class="small muted">'+esc(u.o.kind)+(c?' · '+esc(c):'')+' · '+esc(shortDate(u.d))+'</div>', false, right); }
    });
    h += '</div>';

    h += '<div class="card daycard"><h2>Palavra do dia</h2>';
    if(!ws.length) h += emptyAct('palavra','Nenhuma palavra registrada '+(isToday?'hoje':'neste dia')+'.','Registrar palavra','word');
    ws.forEach(function(w){
      h += '<div class="wblock tap" data-act="view" data-kind="word" data-id="'+w.id+'">'
        + (w.ref?'<div class="wref">'+esc(w.ref)+'</div>':'')
        + (w.text?'<div class="verse"><div class="clamp">'+esc(w.text)+'</div></div>':'')+'</div>';
    });
    h += '</div>';
    return h;
  }

  function viewPalavra(){
    var t = today();
    var title = cap(parse(wordDate).toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'}));
    var h = '<div class="card wide"><div class="mnav" style="margin-bottom:0"><button class="btn ghost sm" data-act="wordPrev" aria-label="Dia anterior">‹</button><strong>'+esc(title)+'</strong><button class="btn ghost sm" data-act="wordNext" aria-label="Próximo dia">›</button></div>'
      + (wordDate!==t ? '<div style="margin-top:0.625rem;text-align:center"><button class="btn ghost sm" data-act="wordToday">Ir para hoje</button></div>' : '') + '</div>';
    var ws = state.words.filter(function(w){return w.date===wordDate;});
    if(!ws.length) h += '<div class="card">'+empty('palavra', wordDate===t ? 'Ainda não há palavra registrada hoje. Toque em + para adicionar.' : 'Nenhuma palavra registrada neste dia.')+'</div>';
    ws.forEach(function(w){ h += '<div class="card">'+wordBlock(w,false)+'</div>'; });
    var rec = state.words.filter(function(w){return w.date!==wordDate;})
      .sort(function(a,b){return b.date.localeCompare(a.date);}).slice(0,15);
    if(rec.length){
      h += '<div class="card"><h2>Registros recentes</h2>';
      rec.forEach(function(w){
        var snip = w.text ? w.text.replace(/\s+/g,' ').slice(0,70)+(w.text.length>70?'…':'') : '';
        h += '<div class="row"><div class="grow tap" data-act="edit" data-kind="word" data-id="'+w.id+'"><strong>'+esc(w.ref||'Sem referência')+'</strong>'+(snip?'<div class="small muted">'+esc(snip)+'</div>':'')+'</div><button class="btn ghost sm" data-act="wordGo" data-date="'+w.date+'">'+shortDate(w.date)+'</button></div>';
      });
      h += '</div>';
    }
    return h + cta('word','Registrar palavra');
  }

  function taskGroupKey(x){
    if(taskGroup==='categoria') return x.area || 'Geral';
    if(taskGroup==='prioridade') return x.prio ? PRIO[x.prio] : 'Sem prioridade';
    if(x.done) return 'Concluídas';
    if(!x.date) return 'Sem data';
    var n = daysUntil(x.date);
    return n<0 ? 'Atrasadas' : n===0 ? 'Hoje' : n===1 ? 'Amanhã' : n<=7 ? 'Próximos 7 dias' : 'Mais adiante';
  }
  var GORDER = {
    data:['Atrasadas','Hoje','Amanhã','Próximos 7 dias','Mais adiante','Sem data','Concluídas'],
    categoria:AREAS, prioridade:['Alta','Média','Baixa','Sem prioridade']
  };
  function viewTarefas(){
    var t = today();
    if(!state.tasks.length){
      return '<div class="card wide firstcard"><div class="empty big">'+ICON.tarefas+'<div>Você ainda não tem tarefas.</div><button class="btn" data-act="openSheet" data-kind="task">Criar primeira tarefa</button></div></div>';
    }
    var base = state.tasks.filter(function(x){ return (!areaFilter || x.area===areaFilter) && (!taskPrio || x.prio===taskPrio); });
    var TABS_T = [
      ['hoje','Hoje', function(x){return !x.done && x.date && x.date<=t;}],
      ['proximas','Próximas', function(x){return !x.done && x.date && x.date>t;}],
      ['concluidas','Concluídas', function(x){return x.done;}],
      ['todas','Todas', function(){return true;}]
    ];
    var nf = (areaFilter?1:0) + (taskPrio?1:0) + (taskGroup!=='data'?1:0);
    var h = '<div class="card wide tbar"><div class="ttabs" role="tablist" aria-label="Filtrar tarefas">';
    TABS_T.forEach(function(x){
      var n = base.filter(x[2]).length;
      h += '<button role="tab" class="ttab" data-act="taskTab" data-v="'+x[0]+'" aria-selected="'+(taskTab===x[0])+'">'+x[1]+'<span class="cnt">'+n+'</span></button>';
    });
    h += '</div><div class="tq"><input id="newTask" class="f" data-enter="addTask" placeholder="Nova tarefa e Enter" aria-label="Nova tarefa">'
      + '<button class="btn sm" data-act="addTask">Adicionar</button>'
      + '<button class="btn ghost sm" data-act="toggleFilters" aria-expanded="'+filtersOpen+'">Filtros'+(nf?'<span class="cnt on">'+nf+'</span>':'')+'</button></div>';
    if(filtersOpen){
      h += '<div class="fpanel"><label class="fld">Categoria<select data-tf="area"><option value="">Todas</option>'+opts(AREAS, areaFilter)+'</select></label>'
        + '<label class="fld">Prioridade<select data-tf="prio"><option value="">Todas</option>'
        + ['alta','media','baixa'].map(function(k){return '<option value="'+k+'"'+(taskPrio===k?' selected':'')+'>'+PRIO[k]+'</option>';}).join('')+'</select></label>'
        + '<label class="fld">Agrupar por<select data-tf="group">'
        + [['data','Data'],['categoria','Categoria'],['prioridade','Prioridade']].map(function(k){return '<option value="'+k[0]+'"'+(taskGroup===k[0]?' selected':'')+'>'+k[1]+'</option>';}).join('')+'</select></label>'
        + (nf?'<button class="btn ghost sm" data-act="clearFilters">Limpar filtros</button>':'')+'</div>';
    }
    h += '</div>';

    var cur = TABS_T.filter(function(x){return x[0]===taskTab;})[0] || TABS_T[0];
    var list = base.filter(cur[2]);
    if(!list.length){
      var msg = {hoje:'Nada pendente para hoje.', proximas:'Nenhuma tarefa agendada para os próximos dias.', concluidas:'Nenhuma tarefa concluída ainda.', todas:'Nenhuma tarefa encontrada.'}[cur[0]];
      return h + '<div class="card wide"><div class="empty">'+ICON.tarefas+'<div>'+(nf && !base.length ? 'Nenhuma tarefa com esses filtros.' : msg)+'</div>'
        + (nf && !base.length ? '<button class="btn ghost sm" data-act="clearFilters">Limpar filtros</button>' : '<button class="btn ghost sm" data-act="openSheet" data-kind="task">+ Adicionar tarefa</button>')
        + '</div></div>' + cta('task','Adicionar tarefa');
    }
    list.sort(function(a,b){
      if(a.done!==b.done) return a.done?1:-1;
      var pa = a.prio?PRANK[a.prio]:3, pb = b.prio?PRANK[b.prio]:3;
      if(taskGroup==='data' && cur[0]!=='concluidas') return (a.date||'9999').localeCompare(b.date||'9999') || pa-pb;
      return pa-pb || (a.date||'9999').localeCompare(b.date||'9999');
    });
    var groups = {};
    list.forEach(function(x){ var k = taskGroupKey(x); (groups[k] = groups[k] || []).push(x); });
    h += '<div class="card wide tlist">';
    GORDER[taskGroup].forEach(function(k){
      if(!groups[k]) return;
      h += '<div class="grp"><span>'+k+'</span><span class="cnt">'+groups[k].length+'</span>'
        + (k==='Concluídas' ? '<button class="btn ghost sm" data-act="clearDone">Limpar</button>' : '')+'</div>';
      groups[k].forEach(function(x){ h += taskRow(x); });
    });
    h += '</div>';
    if(cur[0]==='concluidas' && taskGroup!=='data') h += '';
    return h + cta('task','Adicionar tarefa');
  }

  function statBox(ic, big, label, small, bigCls){
    return '<div class="stat">'+ICON[ic]+'<span class="sv money'+(bigCls?' '+bigCls:'')+'">'+esc(big)+'</span><span class="sl">'+esc(label)+'</span><span class="sl">'+esc(small)+'</span></div>';
  }
  function goalRow(g){
    var lk = goalLinked(g), cur = goalCurrent(g);
    var pct = g.target>0 ? Math.max(0, Math.min(100, Math.round(cur/g.target*100))) : 0;
    var meta = (lk ? 'Automática · '+esc(goalLinkLabel(g)) : '') + (g.area!=='Geral' ? (lk?' · ':'')+esc(g.area) : '');
    var due = g.due ? '<span class="tag dt '+dueClass(g.due)+'">Prazo '+esc(shortDate(g.due))+' · '+esc(dueLabel(g.due))+'</span>' : '';
    return '<div class="goal"><div class="between"><div class="tap" data-act="edit" data-kind="goal" data-id="'+g.id+'"><strong>'+esc(g.name)+'</strong>'+(meta?'<div class="small muted">'+meta+'</div>':'')+(due?'<div class="tmeta">'+due+'</div>':'')+'</div><button class="x" data-act="delGoal" data-id="'+g.id+'" aria-label="Remover">×</button></div>'
      + '<div class="bar"><i style="width:'+pct+'%"></i></div>'
      + (lk
        ? '<div class="goalrow"><span class="val neutral">'+BRL.format(cur)+'</span><span class="small muted grow">de '+goalTarget(g)+' · '+pct+'%</span></div>'
        : '<div class="goalrow"><input class="num" type="number" step="any" inputmode="decimal" data-change="goalSet" data-id="'+g.id+'" value="'+g.current+'" aria-label="Valor atual"><span class="small muted grow">de '+goalTarget(g)+' · '+pct+'%</span>'
          + '<span class="btns"><button class="btn ghost sm" data-act="goalMinus" data-id="'+g.id+'" aria-label="Diminuir">−</button><button class="btn sm" data-act="goalPlus" data-id="'+g.id+'">+'+NUM.format(g.step)+'</button></span></div>')
      + '</div>';
  }
  function habWeekDays(){
    var d = new Date(), dow = (d.getDay()+6)%7, out = [];
    d = addDays(d, -dow + habWeek*7);
    for(var i=0;i<7;i++){ out.push(ymd(d)); d = addDays(d,1); }
    return out;
  }
  function habRate(hb){
    var set = new Set(hb.days), n = 0, ok = 0, td = today();
    for(var i=0;i<30;i++){
      var d = addDays(new Date(),-i), k = ymd(d);
      if(hb.created && k<hb.created) break;
      if(hb.sched.indexOf(d.getDay())<0) continue;
      if(k===td && !set.has(k)) continue;
      n++; if(set.has(k)) ok++;
    }
    return n ? Math.round(ok/n*100) : null;
  }
  function viewHabitos(){
    var td = today(), wdToday = new Date().getDay();
    var hs = state.habits.filter(function(x){return inArea(x.area);});
    var gs = state.goals.filter(function(x){return inArea(x.area);});
    var sched = hs.filter(function(x){return x.sched.indexOf(wdToday)>-1;});
    var done = sched.filter(function(x){return x.days.indexOf(td)>-1;}).length;
    var pct = sched.length ? Math.round(done/sched.length*100) : 0;
    var best = hs.reduce(function(m,x){return Math.max(m, streak(x));}, 0);
    var withDue = gs.filter(function(g){return g.due;});
    var h = '<div class="stats">'
      + statBox('habitos', sched.length ? pct+'%' : 'Nenhum', 'Progresso de hoje', sched.length ? done+' de '+sched.length+(sched.length===1?' hábito':' hábitos') : 'Nenhum agendado')
      + statBox('tarefas', String(hs.length), 'Hábitos ativos', hs.length ? 'recorrentes' : 'Crie o primeiro')
      + statBox('fin', best ? best+(best===1?' dia':' dias') : 'Nenhuma', 'Maior sequência', best ? 'seguidos' : 'Marque os dias')
      + statBox('metas', String(gs.length), 'Metas', withDue.length ? withDue.length+' com prazo' : 'sem prazo definido')
      + '</div>';
    h += '<div class="card wide"><div class="between"><h2>Hoje</h2><span class="small muted">'+(sched.length ? done+' de '+sched.length+(sched.length===1?' hábito concluído':' hábitos concluídos')+' hoje' : 'Nenhum hábito agendado para hoje')+'</span></div><div class="bar big"><i style="width:'+pct+'%"></i></div></div>';

    var days = habWeekDays();
    var wl = shortDate(days[0])+' – '+shortDate(days[6]);
    h += '<div class="card wide"><div class="between"><h2>Hábitos da semana</h2><div class="wnav"><button class="btn ghost sm" data-act="habWeekPrev" aria-label="Semana anterior">‹</button><span class="small">'+(habWeek===0?'Esta semana':esc(wl))+'</span><button class="btn ghost sm" data-act="habWeekNext" aria-label="Próxima semana">›</button></div></div>';
    if(!hs.length) h += emptyAct('habitos','Rotinas que se repetem, como academia ou estudar inglês.','Criar hábito','habit');
    else {
      h += '<div class="hgrid"><div></div>';
      days.forEach(function(k){ var d = parse(k); h += '<div class="hh'+(k===td?' today':'')+'">'+NAMES[d.getDay()].charAt(0)+'<b>'+d.getDate()+'</b></div>'; });
      hs.forEach(function(hb){
        var set = new Set(hb.days), st = streak(hb), rt = habRate(hb);
        h += '<div class="hname tap" data-act="edit" data-kind="habit" data-id="'+hb.id+'"><strong>'+esc(hb.name)+'</strong><small>'+esc(schedLabel(hb.sched))+(st?' · '+st+(st===1?' dia seguido':' dias seguidos'):'')+(rt!==null?' · '+rt+'%':'')+'</small></div>';
        days.forEach(function(k){
          var d = parse(k), on = set.has(k), sc = hb.sched.indexOf(d.getDay())>-1, fut = k>td;
          h += '<button class="hc'+(on?' on':'')+(sc?'':' off')+(fut?' fut':'')+(!on&&sc&&!fut&&k<td&&(!hb.created||k>=hb.created)?' miss':'')+(k===td?' today':'')+'" data-act="toggleHabit" data-id="'+hb.id+'" data-date="'+k+'" aria-pressed="'+on+'" aria-label="'+esc(hb.name)+', '+esc(shortDate(k))+'"'+(fut?' disabled':'')+'>'+(on?'✓':'')+'</button>';
        });
      });
      h += '</div><div class="hfoot"><span class="small muted">% = conclusão nos últimos 30 dias</span><button class="btn ghost sm" data-act="openSheet" data-kind="habit">+ Hábito</button></div>';
    }
    h += '</div>';

    h += '<div class="card wide"><div class="between"><h2>Metas</h2><button class="btn ghost sm" data-act="openSheet" data-kind="goal">+ Meta</button></div>';
    if(!gs.length) h += emptyAct('metas','Defina algo mensurável, como "Ler 12 livros" ou "Guardar R$ 3.000".','Criar meta','goal');
    var gd = gs.filter(function(g){return g.due;}).sort(function(a,b){return a.due.localeCompare(b.due);});
    var gc = gs.filter(function(g){return !g.due;});
    if(gd.length){ h += '<div class="grp"><span>Com prazo</span><span class="cnt">'+gd.length+'</span></div>'; gd.forEach(function(g){ h += goalRow(g); }); }
    if(gc.length){ h += '<div class="grp"><span>Contínuas</span><span class="cnt">'+gc.length+'</span></div>'; gc.forEach(function(g){ h += goalRow(g); }); }
    h += '</div>';
    return h + cta('habit','Novo hábito');
  }

  function facCourseMatch(id){ return !facCourse || id===facCourse; }
  function facPending(cid){
    return state.items.filter(function(i){return !i.done && i.course===cid;}).length + state.tasks.filter(function(x){return !x.done && x.course===cid;}).length;
  }
  function spot(label, i, emptyTxt){
    if(!i) return '<button class="stat" data-act="openSheet" data-kind="item">'+ICON.fac+'<span class="sv txt">Nenhum</span><span class="sl">'+label+'</span><span class="sl">'+emptyTxt+'</span></button>';
    var c = courseName(i.course), n = daysUntil(i.date);
    return '<button class="stat" data-act="view" data-kind="item" data-id="'+i.id+'">'+ICON.fac+'<span class="sv txt '+(n<=2?'warn':'')+'">'+esc(dueLabel(i.date))+'</span><span class="sl">'+label+'</span><span class="sl">'+esc(i.title)+'</span><span class="sl">'+esc(i.kind+(c?' · '+c:'')+' · '+shortDate(i.date))+'</span></button>';
  }
  function facCal(){
    var y = +facMonth.slice(0,4), m = +facMonth.slice(5,7), td = today();
    var lead = new Date(y,m-1,1).getDay(), last = new Date(y,m,0).getDate();
    var ev = {};
    function add(date, exam, done){ if(!date) return; var e = ev[date] = ev[date] || {p:[],o:[]}; (exam?e.p:e.o).push(done); }
    state.items.forEach(function(i){ if(facCourseMatch(i.course)) add(i.date, i.kind==='Prova', i.done); });
    state.tasks.forEach(function(x){ if(x.course && facCourseMatch(x.course)) add(x.date, false, x.done); });
    var label = cap(new Date(y,m-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}));
    var h = '<div class="card wide"><div class="mnav"><button class="btn ghost sm" data-act="facPrev" aria-label="Mês anterior">‹</button><strong>'+esc(label)+'</strong><button class="btn ghost sm" data-act="facNext" aria-label="Próximo mês">›</button></div><div class="cal">';
    NAMES.forEach(function(n){ h += '<div class="ch">'+n+'</div>'; });
    for(var b=0;b<lead;b++) h += '<span></span>';
    for(var d=1; d<=last; d++){
      var k = facMonth+'-'+pad(d), e = ev[k], dots = '';
      if(e){
        if(e.p.length) dots += '<i class="dot p'+(e.p.some(function(x){return !x;})?'':' ok')+'"></i>';
        if(e.o.length) dots += '<i class="dot t'+(e.o.some(function(x){return !x;})?'':' ok')+'"></i>';
      }
      h += '<button class="cd'+(k===td?' today':'')+(k===facDay?' sel':'')+(e&&(e.p.some(function(x){return !x;})||e.o.some(function(x){return !x;}))?' has':'')+'" data-act="facDay" data-date="'+k+'" aria-pressed="'+(k===facDay)+'" aria-label="'+d+(e?', com atividades':'')+'"><span>'+d+'</span><span class="dots">'+dots+'</span></button>';
    }
    return h + '</div><div class="legend small muted"><span class="dot p"></span> prova<span class="dot t"></span> trabalho, entrega ou tarefa<span class="dot t ok"></span> concluído</div></div>';
  }
  function viewFac(){
    var t = today();
    var pendI = state.items.filter(function(i){return !i.done;}).sort(function(a,b){return a.date.localeCompare(b.date);});
    var nextExam = pendI.filter(function(i){return i.kind==='Prova' && i.date>=t;})[0];
    var nextDue = pendI.filter(function(i){return i!==nextExam && i.date>=t;})[0];
    var h = '<div class="spots">'+spot('Próxima prova', nextExam, 'Nenhuma prova marcada')+spot('Prazo mais próximo', nextDue, 'Nenhum prazo à vista')+'</div>';

    h += '<div class="card wide"><div class="between"><h2>Matérias</h2><span class="small muted">'+plural(state.courses.length,'matéria','matérias')+'</span></div>';
    if(!state.courses.length) h += empty('fac','Cadastre as matérias do período para organizar provas, trabalhos e tarefas.');
    else {
      h += '<div class="cgrid"><button class="cc'+(facCourse?'':' sel')+'" data-act="facCourse" data-id=""><strong>Todas</strong><span class="small muted">'+plural(state.items.filter(function(i){return !i.done;}).length + state.tasks.filter(function(x){return !x.done && x.course;}).length,'pendência','pendências')+'</span></button>';
      state.courses.forEach(function(c){
        var n = facPending(c.id);
        var nx = pendI.filter(function(i){return i.course===c.id && i.date>=t;})[0];
        h += '<button class="cc'+(facCourse===c.id?' sel':'')+'" data-act="facCourse" data-id="'+c.id+'"><strong>'+esc(c.name)+'</strong>'
          + '<span class="small '+(n?'':'muted')+'">'+(n ? '<span class="pbadge">'+n+'</span> '+(n===1?'pendência':'pendências') : 'Em dia')+'</span>'
          + '<span class="small muted">'+(nx ? esc(nx.kind)+' · '+esc(shortDate(nx.date)) : 'Sem prazos')+'</span></button>';
      });
      h += '</div>';
    }
    h += '<div class="add"><input class="f" id="newCourse" data-enter="addCourse" placeholder="Nova matéria. Ex.: Auditoria I"><button class="btn sm" data-act="addCourse">Adicionar</button></div></div>';

    h += facCal();

    var cn = facCourse ? courseName(facCourse) : '';
    var list = [];
    state.items.forEach(function(i){ if(facCourseMatch(i.course) && (!facDay || i.date===facDay)) list.push({k:'item', o:i, d:i.date, done:i.done, title:i.title, tag:i.kind, c:i.course}); });
    state.tasks.forEach(function(x){ if(x.course && facCourseMatch(x.course) && (!facDay || x.date===facDay)) list.push({k:'task', o:x, d:x.date||'9999', done:x.done, title:x.text, tag:'Tarefa', c:x.course}); });
    list.sort(function(a,b){ return (a.done===b.done ? 0 : a.done?1:-1) || a.d.localeCompare(b.d); });
    h += '<div class="card wide"><div class="between"><h2>'+(cn?esc(cn):'Todas as atividades')+(facDay?' · '+esc(shortDate(facDay)):'')+'</h2><span class="dchd">'
      + (facDay ? '<button class="btn ghost sm" data-act="facDay" data-date="'+facDay+'">Limpar dia</button>' : '')
      + '<button class="btn ghost sm" data-act="openSheet" data-kind="item">+ Prazo</button><button class="btn ghost sm" data-act="openSheet" data-kind="task">+ Tarefa</button></span></div>';
    if(!list.length) h += '<div class="empty">'+ICON.fac+'<div>'+(facDay?'Nada neste dia.':'Nenhuma atividade'+(cn?' em '+esc(cn):'')+' ainda.')+'</div></div>';
    list.forEach(function(u){
      var isI = u.k==='item', late = !u.done && u.d<t;
      h += '<div class="row"><input type="checkbox" class="chk" data-act="'+(isI?'toggleItem':'toggleTask')+'" data-id="'+u.o.id+'" '+(u.done?'checked':'')+' aria-label="Concluir"><div class="grow tap '+(u.done?'done':'')+'" data-act="edit" data-kind="'+u.k+'" data-id="'+u.o.id+'">'+esc(u.title)
        + '<div class="tmeta"><span class="tag'+(u.tag==='Prova' ? ' p-media' : '')+'">'+esc(u.tag)+'</span>'
        + (u.d!=='9999' ? '<span class="tag dt '+(u.done?'':dueClass(u.d))+'">'+esc(dueLabel(u.d)+' · '+shortDate(u.d))+'</span>' : '')
        + (!facCourse && courseName(u.c) ? '<span class="tag co">'+esc(courseName(u.c))+'</span>' : '')+'</div></div>'
        + '<button class="x" data-act="'+(isI?'delItem':'delTask')+'" data-id="'+u.o.id+'" aria-label="Remover">×</button></div>';
    });
    if(facCourse) h += '<div class="hfoot"><span></span><button class="btn ghost danger sm" data-act="delCourse" data-id="'+facCourse+'">Remover matéria</button></div>';
    h += '</div>';
    return h + cta('item','Novo prazo');
  }

  function viewResumo(){
    var label = periodLabel();
    var all = state.tx.filter(function(t){return inPeriod(t.date);});
    var list = all.filter(function(t){return !t.planned;}).sort(function(a,b){return b.date.localeCompare(a.date);});
    var plan = all.filter(function(t){return t.planned && t.type!=='transfer';}).sort(function(a,b){return a.date.localeCompare(b.date);});
    var inn = 0, out = 0, byCat = {}, pIn = 0, pOut = 0;
    list.forEach(function(t){
      if(t.type==='in') inn += t.amount; else if(t.type==='out'){ out += t.amount; byCat[t.cat] = (byCat[t.cat]||0)+t.amount; }
    });
    plan.forEach(function(t){ if(t.type==='in') pIn += t.amount; else pOut += t.amount; });
    inn = r2(inn); out = r2(out);
    var saldo = r2(inn-out), proj = r2(saldo+pIn-pOut);
    var PER = [['mes','Mês'],['trim','3 meses'],['ano','Ano']];
    var h = '<div class="card wide"><div class="chipbar fpd" role="group" aria-label="Período">'
      + PER.map(function(p){ return '<button class="chip" data-act="finPeriod" data-v="'+p[0]+'" aria-pressed="'+(finPeriod===p[0])+'">'+p[1]+'</button>'; }).join('')
      + '</div><div class="mnav"><button class="btn ghost sm" data-act="monthPrev" aria-label="Período anterior">‹</button><strong>'+esc(label)+'</strong><button class="btn ghost sm" data-act="monthNext" aria-label="Próximo período">›</button></div></div>';
    h += '<div class="stats">'
      + statBox('fin', BRL.format(saldo), 'Saldo realizado', 'Receitas − despesas', saldo<0?'bad':'')
      + statBox('tarefas', BRL.format(inn), 'Receitas', plural(list.filter(function(t){return t.type==='in';}).length,'lançamento','lançamentos'))
      + statBox('hoje', BRL.format(out), 'Despesas', plural(list.filter(function(t){return t.type==='out';}).length,'lançamento','lançamentos'))
      + statBox('metas', BRL.format(proj), 'Saldo projetado', plan.length ? 'com '+plural(plan.length,'previsto','previstos') : 'Nada previsto', proj<0?'bad':'')
      + '</div>';

    var tIn = r2(inn+pIn), tOut = r2(out+pOut);
    h += '<div class="card"><h2>Planejado × realizado</h2>'
      + '<div class="pr"><div class="between"><span>Receitas</span><span class="small muted">'+BRL.format(inn)+' de '+BRL.format(tIn)+'</span></div><div class="bar"><i style="width:'+(tIn>0?Math.round(inn/tIn*100):0)+'%"></i></div></div>'
      + '<div class="pr"><div class="between"><span>Despesas</span><span class="small muted">'+BRL.format(out)+' de '+BRL.format(tOut)+'</span></div><div class="bar out"><i style="width:'+(tOut>0?Math.round(out/tOut*100):0)+'%"></i></div></div>';
    if(!plan.length) h += '<div class="small muted" style="margin-top:0.5rem">Nenhum lançamento previsto neste período. Marque “Previsto” ao criar algo que ainda vai acontecer, como aluguel ou salário.</div>';
    plan.forEach(function(t){
      h += '<div class="row"><div class="grow tap" data-act="edit" data-kind="tx" data-id="'+t.id+'">'+esc(t.desc||t.cat)+'<div class="small muted">Previsto · '+txMeta(t)+'</div></div><span class="val '+(t.type==='out'?'out':'')+'">'+(t.type==='out'?'−':'+')+BRL.format(t.amount)+'</span><button class="btn ghost sm" data-act="realizeTx" data-id="'+t.id+'">Realizar</button></div>';
    });
    h += '<div class="add"><button class="btn ghost sm" data-act="openSheet" data-kind="tx">+ Lançamento</button></div></div>';

    var cats = Object.keys(byCat).sort(function(a,b){return byCat[b]-byCat[a];});
    h += '<div class="card"><h2>Gastos por categoria</h2>';
    if(!cats.length) h += '<div class="small muted">Sem despesas neste período.</div>';
    cats.forEach(function(c){
      var p = out>0 ? Math.round(byCat[c]/out*100) : 0;
      h += '<div class="cat"><span class="lbl">'+esc(c)+' <span class="muted">'+p+'%</span></span><div class="bar"><i style="width:'+p+'%"></i></div><span class="v">'+BRL.format(byCat[c])+'</span></div>';
    });
    h += '</div>';

    var sg = state.goals.filter(function(g){return goalLinked(g) || g.unit==='R$';});
    h += '<div class="card wide"><div class="between"><h2>Metas de economia</h2><button class="btn ghost sm" data-act="openSheet" data-kind="goal">+ Meta</button></div>';
    if(!sg.length) h += '<div class="small muted">Crie uma meta em R$ e vincule a uma conta para acompanhar o progresso automaticamente.</div>';
    sg.forEach(function(g){ h += goalRow(g); });
    h += '</div>';

    var vlist = finDay && finPeriod==='mes' ? list.filter(function(t){return t.date===finDay;}) : list;
    h += '<div class="card wide"><div class="between"><h2>Lançamentos</h2><button class="btn ghost sm" data-act="toggleFold" data-k="res" aria-expanded="'+(!fold.res)+'">'+(fold.res?'Mostrar':'Minimizar')+'</button></div>';
    if(fold.res){
      h += '<div class="small muted" style="margin-top:0.375rem">'+vlist.length+(vlist.length===1?' lançamento':' lançamentos')+(finDay&&finPeriod==='mes'?' em '+esc(shortDate(finDay)):' no período')+'</div></div>';
    } else {
      if(finPeriod==='mes') h += dayStrip(dayHas(list), false);
      if(!vlist.length) h += empty('fin', finDay ? 'Nenhum lançamento neste dia.' : 'Nenhum lançamento neste período. Toque em + para adicionar.');
      var dIn = {}, dOut = {}, dHas = {}, dCnt = {}, lastDay = '', skipDay = false;
      vlist.forEach(function(t){
        dCnt[t.date] = (dCnt[t.date]||0)+1;
        if(t.type==='in'){ dIn[t.date] = r2((dIn[t.date]||0)+t.amount); dHas[t.date] = true; }
        else if(t.type==='out'){ dOut[t.date] = r2((dOut[t.date]||0)+t.amount); dHas[t.date] = true; }
      });
      vlist.forEach(function(t){
        if(t.date!==lastDay){
          lastDay = t.date;
          var dkey = 'r:'+t.date; skipDay = !!closedDays[dkey];
          var di = dIn[t.date]||0, dout = dOut[t.date]||0;
          var sb = (di?'Entradas '+BRL.format(di):'')+(di&&dout?' · ':'')+(dout?'Saídas '+BRL.format(dout):'');
          if(skipDay) sb += (sb?' · ':'')+dCnt[t.date]+(dCnt[t.date]===1?' lançamento':' lançamentos');
          h += dayHead(t.date, dHas[t.date] ? r2(di-dout) : null, di>=dout, sb, dkey, skipDay);
        }
        if(skipDay) return;
        h += '<div class="row"><div class="grow tap" data-act="edit" data-kind="tx" data-id="'+t.id+'">'+esc(t.desc||t.cat)+'<div class="small muted">'+txMeta(t)+'</div></div><span class="val '+(t.type==='out'?'out':(t.type==='transfer'?'neutral':''))+'">'+(t.type==='out'?'−':(t.type==='in'?'+':''))+BRL.format(t.amount)+'</span><button class="x" data-act="delTx" data-id="'+t.id+'" aria-label="Remover">×</button></div>';
      });
      h += '</div>';
    }
    return h + cta('tx','Novo lançamento');
  }

  function viewContas(){
    var nw = netWorth();
    var h = '<div class="card wide"><h2>Patrimônio</h2><div class="sum"><span>Ativos</span><span>'+BRL.format(nw.A)+'</span><span>Passivos</span><span class="over">'+BRL.format(nw.L)+'</span></div>'
      + '<div class="total"><span>Patrimônio líquido</span><span class="'+(nw.N<0?'over':'')+'">'+BRL.format(nw.N)+'</span></div></div>';
    if(!state.accounts.length) h += '<div class="card">'+empty('fin','Cadastre suas contas, como caixa, banco, poupança e cartão, para acompanhar o patrimônio.')+'</div>';
    [['ativo','Ativos'],['passivo','Passivos']].forEach(function(g){
      var list = state.accounts.filter(function(a){return a.cls===g[0];});
      if(!list.length) return;
      h += '<div class="card"><h2>'+g[1]+'</h2>';
      list.forEach(function(a){
        h += '<div class="row tap" data-act="acctOpen" data-id="'+a.id+'"><div class="grow">'+esc(a.name)+'<div class="small muted">'+esc(a.kind)+'</div></div><span class="val neutral">'+BRL.format(acctBal(a))+'</span><span class="chev" aria-hidden="true">›</span></div>';
      });
      h += '</div>';
    });
    return h + cta('acct','Nova conta');
  }

  function viewConta(a){
    var liab = a.cls==='passivo', bal = acctBal(a);
    var all = acctLedger(a);
    var period = acctPeriod==='month' ? all.filter(function(m){return m.t.date.indexOf(finMonth)===0;}) : all;
    var shown = finDay ? period.filter(function(m){return m.t.date===finDay;}) : period;
    var variation = r2(shown.reduce(function(s,m){return s+m.d;}, 0));
    var y = +finMonth.slice(0,4), m0 = +finMonth.slice(5,7);
    var label = cap(new Date(y,m0-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}));
    var h = '<div class="card wide"><div class="between"><button class="btn ghost sm" data-act="acctBack">‹ Contas</button><span class="btns"><button class="btn ghost sm" data-act="edit" data-kind="acct" data-id="'+a.id+'">Editar</button><button class="btn ghost sm danger" data-act="delAcct" data-id="'+a.id+'">Excluir</button></span></div>'
      + '<div style="margin-top:0.875rem"><span class="tag">'+(liab?'Passivo':'Ativo')+' · '+esc(a.kind)+'</span></div>'
      + '<div class="total"><span>'+(liab?'Saldo devedor':'Saldo')+'</span><span class="'+(bal<0&&!liab?'over':'')+'">'+BRL.format(bal)+'</span></div>'
      + '<div class="add" style="margin-top:0.875rem"><button class="chip" data-act="acctAll" aria-pressed="'+(acctPeriod==='all')+'">Todo o período</button><button class="chip" data-act="acctMonth" aria-pressed="'+(acctPeriod==='month')+'">Por mês</button></div>'
      + (acctPeriod==='month' ? '<div class="mnav" style="margin:0.75rem 0 0"><button class="btn ghost sm" data-act="monthPrev" aria-label="Mês anterior">‹</button><strong>'+esc(label)+'</strong><button class="btn ghost sm" data-act="monthNext" aria-label="Próximo mês">›</button></div>' : '')
      + '</div>';
    var vtxt = 'Variação '+(acctPeriod==='month'?'no mês':'no período')+(finDay?' (dia filtrado)':'')+': '+(variation>=0?'+':'−')+BRL.format(Math.abs(variation));
    h += '<div class="card wide"><div class="between"><h2>Movimentação</h2><span class="btns"><span class="small muted" style="align-self:center">'+shown.length+(shown.length===1?' lançamento':' lançamentos')+'</span><button class="btn ghost sm" data-act="toggleFold" data-k="mov" aria-expanded="'+(!fold.mov)+'">'+(fold.mov?'Mostrar':'Minimizar')+'</button></span></div>';
    if(fold.mov){
      h += '<div class="small muted" style="margin-top:0.5rem">'+vtxt+'</div></div>';
    } else {
      h += dayStrip(dayHas(period.map(function(m){return m.t;})), acctPeriod==='all');
      if(!shown.length) h += empty('fin', all.length ? (finDay ? 'Nenhuma movimentação neste dia.' : 'Nenhuma movimentação neste mês.') : 'Nenhuma movimentação nesta conta. Toque em Novo lançamento.');
      var dVar = {}, dEnd = {}, dCntA = {}, lastDayA = '', skipA = false;
      shown.forEach(function(m){ dVar[m.t.date] = r2((dVar[m.t.date]||0)+m.d); dEnd[m.t.date] = m.bal; dCntA[m.t.date] = (dCntA[m.t.date]||0)+1; });
      shown.slice().reverse().forEach(function(mv){
        if(mv.t.date!==lastDayA){
          lastDayA = mv.t.date;
          var dkeyA = 'a:'+a.id+':'+lastDayA; skipA = !!closedDays[dkeyA];
          var dv = dVar[lastDayA];
          var sbA = 'Saldo no fim do dia '+BRL.format(dEnd[lastDayA]) + (skipA ? ' · '+dCntA[lastDayA]+(dCntA[lastDayA]===1?' lançamento':' lançamentos') : '');
          h += dayHead(lastDayA, dv, liab ? dv<=0 : dv>=0, sbA, dkeyA, skipA);
        }
        if(skipA) return;
        var t = mv.t, other = acctById(t.account===a.id ? t.to : t.account);
        var title = t.type==='transfer'
          ? (t.account===a.id ? 'Transferência para '+(other?other.name:'conta removida') : 'Transferência de '+(other?other.name:'conta removida'))
          : (t.desc || t.cat);
        var good = liab ? mv.d<0 : mv.d>0;
        h += '<div class="row"><div class="grow tap" data-act="edit" data-kind="tx" data-id="'+t.id+'">'+esc(title)+'<div class="small muted">'+(t.type==='transfer'?'Transferência':esc(t.cat))+' · '+shortDate(t.date)+'</div></div>'
          + '<div class="amtcol"><div class="val '+(good?'':'out')+'">'+(mv.d>=0?'+':'−')+BRL.format(Math.abs(mv.d))+'</div><div class="runbal">Saldo '+BRL.format(mv.bal)+'</div></div>'
          + '<button class="x" data-act="delTx" data-id="'+t.id+'" aria-label="Remover">×</button></div>';
      });
      if(acctPeriod==='all' && !finDay) h += '<div class="row"><div class="grow muted">Saldo inicial</div><div class="amtcol"><div class="val neutral">'+BRL.format(a.opening||0)+'</div></div><span style="width:2.75rem"></span></div>';
      h += '<div class="small muted" style="margin-top:0.625rem">'+vtxt+'</div></div>';
    }
    return h + cta('tx','Novo lançamento');
  }

  function viewFin(){
    if(finView==='resumo') return viewResumo();
    var a = acctById(acctView);
    if(!a){ acctView = ''; return viewContas(); }
    return viewConta(a);
  }

  function authView(){
    var h = '<div class="auth">';
    if(!cryptoOk){
      return h + '<p class="muted">Este navegador não liberou a criptografia necessária. Abra o app pelo endereço https do site.</p></div>';
    }
    if(authMode==='pick'){
      h += '<div class="card" style="padding:0.375rem 1rem 1rem">';
      accounts.forEach(function(a){ h += '<button class="accbtn" data-act="authPick" data-id="'+a.id+'"><span>'+esc(a.name)+'</span><span aria-hidden="true">›</span></button>'; });
      h += '</div><button class="btn ghost block" data-act="authNew">Criar nova conta</button>';
    } else if(authMode==='login'){
      var acc = byId(accounts, authTarget) || accounts[0];
      h += '<div class="card"><form data-form="login" class="form" style="margin-top:0" autocomplete="on">'
        + '<label class="fld full">Conta<input name="username" value="'+esc(acc?acc.name:'')+'" readonly autocomplete="username"></label>'
        + '<label class="fld full">Senha<input name="pw" type="password" autocomplete="current-password" placeholder="Sua senha"></label>'
        + '<label class="check full"><input type="checkbox" name="keep" checked> Manter conectado neste aparelho</label>'
        + '<p class="msg full" id="authErr" role="alert">'+esc(authError)+'</p>'
        + '<button class="btn full" type="submit">Entrar</button></form></div>';
      h += '<div class="between wrap">'+(accounts.length>1?'<button class="linkbtn" data-act="authBack">Trocar de conta</button>':'<button class="linkbtn" data-act="authNew">Criar outra conta</button>')+'<button class="linkbtn" data-act="forgot">Esqueci a senha</button></div>';
      if(showForgot){
        h += '<div class="card"><p class="small muted">A senha não pode ser recuperada, porque os dados são criptografados com ela. Se você tem um arquivo de backup, apague esta conta, crie uma nova e importe o backup.</p><button class="btn ghost danger" data-act="eraseAcc" data-id="'+(acc?acc.id:'')+'">Apagar esta conta e os dados</button></div>';
      }
    } else if(authMode==='sync'){
      var ls = lastSyncCfg();
      h += '<div class="card"><form data-form="sync" class="form" style="margin-top:0" autocomplete="on">'
        + '<label class="fld full">Nome da conta<input name="name" autocomplete="username" placeholder="O mesmo do outro aparelho" maxlength="30"></label>'
        + '<label class="fld full">Senha<input name="pw" type="password" autocomplete="current-password"></label>'
        + '<label class="fld full">Endereço do projeto<input name="url" value="'+esc(ls.url||'')+'" placeholder="https://abcdxyz.supabase.co" autocapitalize="off" spellcheck="false"></label>'
        + '<label class="fld full">Chave pública (anon ou publishable)<input name="anon" value="'+esc(ls.anon||'')+'" placeholder="Cole a chave aqui" autocapitalize="off" spellcheck="false"></label>'
        + '<label class="check full"><input type="checkbox" name="keep" checked> Manter conectado neste aparelho</label>'
        + '<p class="msg full" id="authErr" role="alert">'+esc(authError)+'</p>'
        + '<button class="btn full" type="submit">Entrar e sincronizar</button></form></div>'
        + '<button class="linkbtn" data-act="authBack">Voltar</button>';
    } else {
      h += '<div class="card"><form data-form="create" class="form" style="margin-top:0" autocomplete="on">'
        + '<label class="fld full">Nome da conta<input name="name" autocomplete="username" placeholder="Ex.: Jorge" maxlength="30"></label>'
        + '<label class="fld full">Senha<input name="pw" type="password" autocomplete="new-password" placeholder="Mínimo de 6 caracteres"></label>'
        + '<label class="fld full">Confirmar senha<input name="pw2" type="password" autocomplete="new-password"></label>'
        + '<label class="check full"><input type="checkbox" name="keep" checked> Manter conectado neste aparelho</label>'
        + '<p class="small muted full" style="margin:0">Atenção: não há como recuperar a senha. Exporte um backup de vez em quando.</p>'
        + '<p class="msg full" id="authErr" role="alert">'+esc(authError)+'</p>'
        + '<button class="btn full" type="submit">Criar conta</button></form></div>';
      if(accounts.length) h += '<button class="linkbtn" data-act="authBack">Voltar</button>';
    }
    if(authMode!=='sync') h += '<div style="text-align:center;margin-top:0.375rem"><button class="linkbtn" data-act="authSync">Já usa em outro aparelho? Entrar com conta sincronizada</button></div>';
    return h + '</div>';
  }

  function plural(n,a,b){ return n+' '+(n===1?a:b); }
  function greeting(){ var h = new Date().getHours(); return h<12 ? 'Bom dia' : (h<18 ? 'Boa tarde' : 'Boa noite'); }
  function firstName(){ var n = (session && session.name || '').trim().split(/\s+/)[0] || ''; return cap(n); }
  function heroInfo(){
    if(!session){
      var at = {pick:'Bem-vindo de volta', login:'Entrar', create:'Crie sua conta', sync:'Conta sincronizada'}[authMode] || 'Meu caderno';
      var as = authMode==='sync' ? 'Use o mesmo nome, senha e servidor do outro aparelho.' : authMode==='create' ? 'Seus dados ficam criptografados e guardados só neste aparelho.'
        : (authMode==='pick' ? 'Escolha a conta para entrar.' : 'Digite a senha para abrir o seu caderno.');
      return {title:at, sub:as, badge:'Rotina, estudos e metas'};
    }
    var t = today(), plural = function(n,a,b){ return n+' '+(n===1?a:b); };
    if(tab==='hoje'){
      var L = dayList(selDate), isT = selDate===t;
      var pendN = L.ts.filter(function(x){return !x.done;}).length;
      if(isT) pendN += state.tasks.filter(function(x){return !x.done && x.date && x.date<t;}).length;
      var parts = [];
      if(pendN) parts.push(plural(pendN,'tarefa pendente','tarefas pendentes')); else if(L.ts.length) parts.push('tarefas em dia');
      if(L.hs.length) parts.push(L.hs.filter(function(x){return x.days.indexOf(selDate)>-1;}).length+' de '+plural(L.hs.length,'hábito','hábitos'));
      var dl = cap(parse(selDate).toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'}));
      return {compact:true, eyebrow:isT ? dl : 'Visualizando outro dia',
        title:isT ? greeting()+', '+firstName()+'!' : dl,
        sub:parts.length ? parts.join(' · ') : 'Dia livre. Use as ações rápidas para planejar.',
        back:!isT};
    }
    if(tab==='palavra'){
      var n = state.words.filter(function(w){return w.date===wordDate;}).length;
      return {title:'Palavra do dia', badge:n ? plural(n,'registro','registros') : 'Sem registro', sub:'Escreva o versículo e o que ele diz para você.'};
    }
    if(tab==='tarefas'){
      var pend = state.tasks.filter(function(x){return !x.done && inArea(x.area);});
      var late = pend.filter(function(x){return x.date && x.date<t;}).length;
      return {title:'Tarefas', badge:plural(pend.length,'pendente','pendentes'), sub:late ? plural(late,'atrasada','atrasadas') : 'Tudo em dia.'};
    }
    if(tab==='habitos'){
      var hs = state.habits.filter(function(x){return inArea(x.area);});
      var best = hs.reduce(function(m,x){return Math.max(m, streak(x));}, 0);
      return {title:'Hábitos e metas', badge:plural(hs.length,'hábito','hábitos'),
        sub:best ? 'Maior sequência: '+plural(best,'dia','dias')+'.' : 'Marque os dias para criar uma sequência.', chips:true};
    }
    if(tab==='fac'){
      var p = state.items.filter(function(i){return !i.done;}).sort(function(a,b){return a.date.localeCompare(b.date);});
      return {title:'Faculdade', badge:plural(p.length,'prazo pendente','prazos pendentes'),
        sub:p.length ? 'Próximo: '+p[0].title+' · '+dueLabel(p[0].date) : 'Nenhum prazo à vista.'};
    }
    var ca = finView!=='resumo' ? acctById(acctView) : null;
    if(ca){
      return {title:ca.name, badge:(ca.cls==='passivo'?'Saldo devedor ':'Saldo ')+BRL.format(acctBal(ca)), sub:(ca.cls==='passivo'?'Passivo':'Ativo')+' · '+ca.kind, seg:true};
    }
    if(finView!=='resumo'){
      var nw = netWorth();
      return {title:'Contas', badge:'Patrimônio '+BRL.format(nw.N), sub:'Ativos '+BRL.format(nw.A)+' · Passivos '+BRL.format(nw.L), seg:true};
    }
    var inn = 0, out = 0;
    state.tx.forEach(function(x){ if(!x.planned && inPeriod(x.date)){ if(x.type==='in') inn += x.amount; else if(x.type==='out') out += x.amount; } });
    var ml = periodLabel();
    return {title:'Finanças', badge:'Saldo '+BRL.format(inn-out), sub:ml+' · entradas, saídas e categorias.', seg:true};
  }
  function heroHtml(){
    var h = heroInfo();
    return '<div class="hero-in">'+(h.compact ? '<div class="eyebrow">'+esc(h.eyebrow)+'</div>' : '<span class="badge">'+esc(h.badge)+'</span>')
      + '<h1>'+esc(h.title)+'</h1><p>'+esc(h.sub)+'</p>'
      + (h.back ? '<button class="hero-link" data-act="goToday">Voltar para hoje</button>' : '')
      + (h.chips ? chipBar() : '') + (h.seg ? segBar() : '') + '</div>';
  }
  function renderTop(){
    var cur = TABS.filter(function(x){return x[0]===tab;})[0];
    $('#top').innerHTML = '<div class="appbar-in">'
      + (session ? '<button class="abtn" data-act="openMenu" aria-label="Abrir menu">'+ICON.menu+'</button>' : '<span></span>')
      + '<div class="atitle"><strong>'+esc(session && cur ? cur[1] : 'Meu caderno')+'</strong>'+(session?'<small id="status">'+esc(statusText)+'</small>':'')+'</div>'
      + (session ? '<button class="abtn" data-act="openSheet" data-kind="account" aria-label="Conta de '+esc(session.name)+'">'+ICON.user+'</button>' : '<span></span>')
      + '</div>';
  }
  function drawerHtml(){
    return '<div class="ov" data-act="closeMenu"></div><nav class="drawer-panel" aria-label="Seções">'
      + '<div class="dr-top"><div><strong>Meu caderno</strong><span>'+esc(session?session.name:'')+'</span></div><button class="x" data-act="closeMenu" aria-label="Fechar menu">×</button></div>'
      + '<div class="dr-list">'
      + TABS.map(function(t){
          return '<button class="dr-item" data-tab="'+t[0]+'"'+(t[0]===tab?' aria-current="page"':'')+'>'+ICON[t[0]]+'<span>'+t[1]+'</span></button>';
        }).join('')
      + '<div class="dr-sep"></div><button class="dr-item" data-act="openSheet" data-kind="account">'+ICON.user+'<span>Conta e backup</span></button></div></nav>';
  }
  function sidebarHtml(){
    return '<div class="dr-top"><div><strong>Meu caderno</strong><span>'+esc(session.name)+'</span></div></div><div class="dr-list">'
      + TABS.map(function(t){
          return '<button class="dr-item" data-tab="'+t[0]+'"'+(t[0]===tab?' aria-current="page"':'')+'>'+ICON[t[0]]+'<span>'+t[1]+'</span></button>';
        }).join('')
      + '<div class="dr-sep"></div><button class="dr-item" data-act="openSheet" data-kind="account">'+ICON.user+'<span>Conta e backup</span></button></div>';
  }
  var menuTimer = 0;
  function openMenu(){
    var d = $('#drawer'); clearTimeout(menuTimer); d.classList.remove('closing'); d.innerHTML = drawerHtml(); d.hidden = false;
    document.body.classList.add('menu-open');
    var a = d.querySelector('[aria-current="page"]') || d.querySelector('.dr-item'); if(a) a.focus();
  }
  function closeMenu(){
    var d = $('#drawer'); if(!d || d.hidden) return;
    document.body.classList.remove('menu-open');
    d.classList.add('closing');
    clearTimeout(menuTimer);
    menuTimer = setTimeout(function(){ d.hidden = true; d.innerHTML = ''; d.classList.remove('closing'); }, 170);
  }
  var swipeX = null;
  document.addEventListener('touchstart', function(e){ swipeX = e.target.closest && e.target.closest('.drawer-panel') ? e.touches[0].clientX : null; }, {passive:true});
  document.addEventListener('touchend', function(e){ if(swipeX!==null && e.changedTouches[0].clientX - swipeX < -60) closeMenu(); swipeX = null; }, {passive:true});
  function render(){
    document.body.classList.toggle('has-side', !!session);
    $('#sidebar').innerHTML = session ? sidebarHtml() : '';
    renderTop();
    $('#hero').innerHTML = heroHtml();
    $('#hero').classList.toggle('compact', !!(session && tab==='hoje'));
    document.body.classList.toggle('is-geral', !!(session && tab==='hoje'));
    if(!session){
      closeMenu();
      $('#view').innerHTML = authView();
      var f = document.querySelector('#view input:not([readonly]):not([type="checkbox"])');
      if(f && (authMode!=='pick')) { try{ f.focus({preventScroll:true}); }catch(e){} }
      return;
    }
    var v = {hoje:viewHoje,palavra:viewPalavra,tarefas:viewTarefas,habitos:viewHabitos,fac:viewFac,fin:viewFin}[tab];
    $('#view').innerHTML = v();
    if(qf){ qf = false; var qi = $('#newTask'); if(qi) qi.focus(); }
    var ds = $('#dstrip');
    if(ds){
      var cs = ds.querySelector('[data-date][aria-pressed="true"]') || ds.querySelector('.today') || ds.querySelector('[data-date]');
      if(cs) ds.scrollLeft = cs.offsetLeft - (ds.clientWidth - cs.offsetWidth)/2;
    }
  }

  /* ================= folhas (formulários) ================= */
  function sheetWrap(title, body){
    return '<div class="ov" data-act="closeSheet"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="'+esc(title)+'">'
      + '<div class="between"><h2>'+esc(title)+'</h2><button class="x" data-act="closeSheet" aria-label="Fechar">×</button></div><div class="form">'+body+'</div></div>';
  }
  function sheetTask(o){
    return sheetWrap(o?'Editar tarefa':'Nova tarefa',
      '<label class="fld full">Tarefa<input id="tkText" data-enter="saveTask" value="'+(o?esc(o.text):'')+'" placeholder="Ex.: Entregar trabalho de Auditoria"></label>'
      + '<label class="fld">Categoria<select id="tkArea">'+opts(AREAS, o?o.area:(areaFilter||'Geral'))+'</select></label>'
      + '<label class="fld">Prioridade<select id="tkPrio"><option value="">Sem prioridade</option>'+['alta','media','baixa'].map(function(k){return '<option value="'+k+'"'+((o?o.prio:taskPrio)===k?' selected':'')+'>'+PRIO[k]+'</option>';}).join('')+'</select></label>'
      + '<label class="fld full">Data<input type="date" min="2000-01-01" max="2099-12-31" id="tkDate" value="'+(o?o.date:(tab==='hoje'?selDate:(tab==='fac'&&facDay?facDay:today())))+'"></label>'
      + (state.courses.length ? '<label class="fld full">Matéria<select id="tkCourse"><option value="">Sem matéria</option>'+state.courses.map(function(c){return '<option value="'+c.id+'"'+((o?o.course:(tab==='fac'?facCourse:''))===c.id?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label>' : '')
      + '<button class="btn full" data-act="saveTask">Salvar</button>');
  }
  function sheetHabit(o){
    var sched = o ? o.sched : [0,1,2,3,4,5,6];
    var pills = ORDER.map(function(d){
      var on = sched.indexOf(d)>-1;
      return '<label class="pill'+(on?' on':'')+'"><input type="checkbox" value="'+d+'"'+(on?' checked':'')+'><span>'+NAMES[d]+'</span></label>';
    }).join('');
    return sheetWrap(o?'Editar hábito':'Novo hábito',
      '<label class="fld full">Nome<input id="hbName" data-enter="saveHabit" value="'+(o?esc(o.name):'')+'" placeholder="Ex.: Academia"></label>'
      + '<label class="fld full">Área<select id="hbArea">'+opts(AREAS, o?o.area:(areaFilter||'Geral'))+'</select></label>'
      + '<div class="fld full">Dias da semana<div class="pills" id="hbDays">'+pills+'</div><div class="presets"><button type="button" class="btn ghost sm" data-act="preset" data-v="all">Todos os dias</button><button type="button" class="btn ghost sm" data-act="preset" data-v="util">Dias úteis</button><button type="button" class="btn ghost sm" data-act="preset" data-v="fds">Fim de semana</button></div></div>'
      + '<button class="btn full" data-act="saveHabit">Salvar</button>');
  }
  function sheetItem(o){
    var courseOpts = '<option value="">Sem matéria</option>' + state.courses.map(function(c){
      return '<option value="'+c.id+'"'+((o?o.course:(tab==='fac'?facCourse:''))===c.id?' selected':'')+'>'+esc(c.name)+'</option>';
    }).join('');
    return sheetWrap(o?'Editar prazo':'Novo prazo',
      '<label class="fld">Tipo<select id="itKind">'+opts(KINDS, o?o.kind:'Prova')+'</select></label>'
      + '<label class="fld">Matéria<select id="itCourse">'+courseOpts+'</select></label>'
      + '<label class="fld full">Título<input id="itTitle" data-enter="saveItem" value="'+(o?esc(o.title):'')+'" placeholder="Ex.: Prova 1"></label>'
      + '<label class="fld full">Data<input type="date" min="2000-01-01" max="2099-12-31" id="itDate" value="'+(o?o.date:(tab==='fac'&&facDay?facDay:today()))+'"></label>'
      + '<button class="btn full" data-act="saveItem">Salvar</button>');
  }
  function sheetTx(o){
    var type = o ? o.type : 'out', tr = type==='transfer', acc = o ? o.account : acctView;
    return sheetWrap(o?'Editar lançamento':'Novo lançamento',
      '<label class="fld">Tipo<select id="txType"><option value="out"'+(type==='out'?' selected':'')+'>Saída</option><option value="in"'+(type==='in'?' selected':'')+'>Entrada</option><option value="transfer"'+(tr?' selected':'')+'>Transferência</option></select></label>'
      + '<label class="fld">Valor<input id="txAmt" inputmode="decimal" data-enter="saveTx" value="'+(o?numStr(o.amount):'')+'" placeholder="25,90"></label>'
      + '<label class="fld full">Descrição<input id="txDesc" data-enter="saveTx" value="'+(o?esc(o.desc):'')+'" placeholder="Ex.: Almoço"></label>'
      + '<label class="fld"><span id="txAcctLbl">'+(tr?'De':'Conta')+'</span><select id="txAcct">'+acctOptions(acc, true)+'</select></label>'
      + '<label class="fld" id="fldCat"'+(tr?' hidden':'')+'>Categoria<select id="txCat">'+opts(CATS, o?o.cat:CATS[0])+'</select></label>'
      + '<label class="fld" id="fldTo"'+(tr?'':' hidden')+'>Para<select id="txTo">'+acctOptions(o?o.to:'', true)+'</select></label>'
      + '<label class="fld full">Data<input type="date" min="2000-01-01" max="2099-12-31" id="txDate" value="'+(o?o.date:today())+'"></label>'
      + '<label class="fld full chkrow"><input type="checkbox" id="txPlanned"'+(o&&o.planned?' checked':'')+'><span>Previsto: ainda não aconteceu (não entra no saldo até ser realizado)</span></label>'
      + '<button class="btn full" data-act="saveTx">Salvar</button>');
  }
  function sheetAcct(o){
    var kinds = ['ativo','passivo'].map(function(c){
      return '<optgroup label="'+(c==='ativo'?'Ativos':'Passivos')+'">'
        + ACCT_KINDS.filter(function(k){return k[1]===c;}).map(function(k){ return '<option'+(o&&o.kind===k[0]?' selected':'')+'>'+k[0]+'</option>'; }).join('')
        + '</optgroup>';
    }).join('');
    return sheetWrap(o?'Editar conta':'Nova conta',
      '<label class="fld full">Nome<input id="acName" data-enter="saveAcct" value="'+(o?esc(o.name):'')+'" placeholder="Ex.: Nubank, Caixa, Poupança"></label>'
      + '<label class="fld full">Tipo<select id="acKind">'+kinds+'</select></label>'
      + '<label class="fld full">Saldo inicial<input id="acOpen" inputmode="decimal" data-enter="saveAcct" value="'+(o?numStr(o.opening):'')+'" placeholder="0,00"></label>'
      + '<p class="small muted full" style="margin:0">Em contas de passivo, como cartão e empréstimo, informe o valor devido.</p>'
      + '<button class="btn full" data-act="saveAcct">Salvar</button>');
  }
  function sheetGoal(o){
    var link = o ? o.link : '', lk = !!link && goalLinked(o);
    var linkOpts = '<option value="">Não, atualizo manualmente</option><option value="__net"'+(link==='__net'?' selected':'')+'>Patrimônio líquido</option>'
      + state.accounts.filter(function(a){return a.cls!=='passivo';}).map(function(a){
          return '<option value="'+a.id+'"'+(link===a.id?' selected':'')+'>Saldo de '+esc(a.name)+'</option>';
        }).join('');
    return sheetWrap(o?'Editar meta':'Nova meta',
      '<label class="fld full">Meta<input id="gName" data-enter="saveGoal" value="'+(o?esc(o.name):'')+'" placeholder="Ex.: Guardar para o intercâmbio"></label>'
      + '<label class="fld full">Acompanhar automaticamente<select id="gLink">'+linkOpts+'</select></label>'
      + '<label class="fld full" id="fldBase"'+(lk?'':' hidden')+'>Contar a partir de (R$)<input id="gBase" inputmode="decimal" value="'+(o&&o.base?numStr(o.base):'')+'" placeholder="0,00"></label>'
      + '<p class="small muted full" id="noteBase"'+(lk?'':' hidden')+' style="margin:-0.375rem 0 0">O progresso é o saldo menos esse valor. Deixe em branco para contar o saldo todo.</p>'
      + '<label class="fld">Alvo<input id="gTarget" inputmode="decimal" value="'+(o?numStr(o.target):'')+'" placeholder="3000"></label>'
      + '<label class="fld" id="fldUnit"'+(lk?' hidden':'')+'>Unidade<input id="gUnit" data-enter="saveGoal" value="'+(o?esc(o.unit):'')+'" placeholder="livros ou R$"></label>'
      + '<label class="fld" id="fldStep"'+(lk?' hidden':'')+'>Passo do botão +<input id="gStep" inputmode="decimal" value="'+(o?numStr(o.step):'1')+'"></label>'
      + '<label class="fld">Área<select id="gArea">'+opts(AREAS, o?o.area:(areaFilter||'Geral'))+'</select></label>'
      + '<label class="fld full">Prazo (opcional)<input type="date" min="2000-01-01" max="2099-12-31" id="gDue" value="'+(o&&o.due?o.due:'')+'"></label>'
      + '<button class="btn full" data-act="saveGoal">Salvar</button>');
  }
  function sheetWord(o){
    return sheetWrap(o?'Editar palavra':'Palavra do dia',
      '<label class="fld full">Referência<input id="wRef" value="'+(o?esc(o.ref):'')+'" placeholder="Ex.: Salmos 23:1-3"></label>'
      + '<label class="fld full">Texto<textarea id="wText" rows="5" placeholder="Escreva ou cole o versículo">'+(o?esc(o.text):'')+'</textarea></label>'
      + '<label class="fld full">Anotação<textarea id="wNote" rows="3" placeholder="O que isso diz para você hoje?">'+(o?esc(o.note):'')+'</textarea></label>'
      + '<label class="fld full">Data<input type="date" min="2000-01-01" max="2099-12-31" id="wDate" value="'+(o?o.date:(tab==='hoje'?selDate:wordDate))+'"></label>'
      + '<button class="btn full" data-act="saveWord">Salvar</button>');
  }
  /* detalhes (somente leitura) */
  function longDate(s){ return cap(parse(s).toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})); }
  function dRow(k, v){ return '<div class="dl full"><span>'+k+'</span><strong>'+v+'</strong></div>'; }
  function stPill(txt, cls){ return '<span class="stpill '+cls+'">'+txt+'</span>'; }
  function detailHtml(kind, o){
    var title = '', body = '', to = '', label = '', dt = '';
    if(kind==='task'){
      title = 'Tarefa';
      var st = o.done ? stPill('Concluída','ok') : (o.date && o.date<today() ? stPill('Atrasada','late') : stPill('Pendente','pend'));
      body = '<div class="full dtitle'+(o.done?' done':'')+'">'+esc(o.text)+'</div><div class="full">'+st+'</div>'
        + dRow('Área', esc(o.area))
        + dRow('Data', o.date ? esc(longDate(o.date))+(o.done?'':' · '+dueLabel(o.date)) : 'Sem data');
      to = 'tarefas'; label = 'Abrir em Tarefas';
    } else if(kind==='habit'){
      title = 'Hábito';
      var set = new Set(o.days), on = set.has(selDate), s = streak(o), cells = '';
      var from = o.created || o.days.slice().sort()[0] || '9999-99-99', tdy = today();
      for(var q=13;q>=0;q--){
        var d = addDays(new Date(),-q), key = ymd(d);
        cells += '<span class="hd '+(set.has(key)?'on':((o.sched.indexOf(d.getDay())>-1 && key>=from && key<tdy)?'miss':'off'))+'" title="'+esc(shortDate(key))+'">'+d.getDate()+'</span>';
      }
      body = '<div class="full dtitle">'+esc(o.name)+'</div>'
        + '<div class="full">'+(on ? stPill('Feito em '+shortDate(selDate),'ok') : stPill('Não feito em '+shortDate(selDate),'pend'))+'</div>'
        + dRow('Dias da semana', schedLabel(o.sched)) + dRow('Área', esc(o.area))
        + dRow('Sequência atual', s+(s===1?' dia':' dias')) + dRow('Total de dias feitos', String(o.days.length))
        + '<div class="full"><div class="dl-label">Últimos 14 dias</div><div class="hist">'+cells+'</div></div>';
      to = 'habitos'; label = 'Abrir em Hábitos';
    } else if(kind==='item'){
      title = 'Prazo';
      var pst = o.done ? stPill('Concluído','ok') : (daysUntil(o.date)<0 ? stPill('Atrasado','late') : stPill('Pendente','pend'));
      body = '<div class="full dtitle'+(o.done?' done':'')+'">'+esc(o.title)+'</div><div class="full">'+pst+'</div>'
        + dRow('Tipo', esc(o.kind)) + dRow('Matéria', esc(courseName(o.course)||'Sem matéria'))
        + dRow('Data', esc(longDate(o.date))+(o.done?'':' · '+dueLabel(o.date)));
      to = 'fac'; label = 'Abrir em Faculdade';
    } else if(kind==='word'){
      title = 'Palavra do dia';
      body = (o.ref?'<div class="full wref">'+esc(o.ref)+'</div>':'')
        + (o.text?'<div class="full verse">'+esc(o.text)+'</div>':'')
        + (o.note?'<div class="full"><div class="dl-label">Anotação</div><div class="wnote">'+esc(o.note)+'</div></div>':'')
        + dRow('Data', esc(longDate(o.date)));
      to = 'palavra'; label = 'Abrir em Palavra'; dt = o.date;
    }
    return sheetWrap(title, body
      + '<button class="btn ghost full" data-act="goTab" data-to="'+to+'" data-date="'+dt+'">'+label+'</button>'
      + '<button class="btn full" data-act="closeSheet">Fechar</button>');
  }
  function openDetail(kind, id){
    var o = LISTS[kind] ? byId(state[LISTS[kind]], id) : null; if(!o) return;
    editing = null;
    var s = $('#sheet'); s.innerHTML = detailHtml(kind, o); s.hidden = false;
    var b = s.querySelector('.btn:not(.ghost)'); if(b) b.focus();
  }

  function syncBlock(){
    if(!syncRec){
      return '<div class="full"><div class="dl-label">Sincronizar entre aparelhos</div><div class="small muted">Opcional. Guarda uma cópia criptografada num projeto gratuito do Supabase, para usar o mesmo caderno no celular e no PC.</div></div>'
        + '<button class="btn ghost full" data-act="openSheet" data-kind="sync">Ativar sincronização</button>';
    }
    return '<div class="full"><div class="dl-label">Sincronização ativa</div><div class="small muted" id="syncLine">'+esc(syncLine())+'</div></div>'
      + '<button class="btn ghost full" data-act="syncNow">Sincronizar agora</button>'
      + '<button class="btn ghost full" data-act="syncOff">Desativar neste aparelho</button>'
      + '<button class="btn ghost danger full" data-act="syncWipe">Apagar a cópia na nuvem</button>';
  }
  function sheetSync(){
    var ls = lastSyncCfg();
    return sheetWrap('Ativar sincronização',
      '<p class="small muted full" style="margin:0">Cria uma cópia criptografada dos seus dados no seu projeto do Supabase. O servidor guarda só dados embaralhados: sem a sua senha, ninguém consegue ler.</p>'
      + '<label class="fld full">Endereço do projeto<input id="syUrl" value="'+esc(ls.url||'')+'" placeholder="https://abcdxyz.supabase.co" autocapitalize="off" spellcheck="false"></label>'
      + '<label class="fld full">Chave pública (anon ou publishable)<input id="syKey" value="'+esc(ls.anon||'')+'" placeholder="Cole a chave aqui" autocapitalize="off" spellcheck="false"></label>'
      + '<label class="fld full">Senha desta conta<input id="syPw" type="password" autocomplete="current-password" data-enter="enableSync"></label>'
      + '<p class="msg full" id="sheetErr" role="alert"></p>'
      + '<button class="btn full" data-act="enableSync">Ativar e sincronizar</button>'
      + '<details class="full help"><summary>Como criar o servidor (uma vez só, gratuito)</summary><ol>'
      + '<li>Crie uma conta em supabase.com e um projeto novo.</li>'
      + '<li>Abra o <b>SQL Editor</b>, cole o script abaixo e clique em <b>Run</b>.</li>'
      + '<li>Em <b>Project Settings → API</b>, copie o <b>Project URL</b> e a chave <b>anon</b> (ou publishable) e cole acima.</li>'
      + '<li>No outro aparelho, use "Entrar com conta sincronizada" com o mesmo nome, senha, endereço e chave.</li></ol>'
      + '<textarea id="sqlText" readonly rows="6" style="width:100%;font-size:.78rem">'+esc(SYNC_SQL)+'</textarea>'
      + '<button class="btn ghost sm" style="margin-top:0.5rem" data-act="copySql">Copiar script SQL</button></details>');
  }
  function sheetAccount(){
    return sheetWrap('Conta',
      '<div class="full"><strong>'+esc(session.name)+'</strong><div class="small muted">Os dados ficam criptografados neste aparelho. Exporte um backup de vez em quando para não perdê-los.</div>'
      + '<div class="statline'+(syncRec && !syncErr?' ok':'')+'">'+(syncRec ? esc(syncLine()) : 'Sem sincronização: seus dados existem só neste aparelho. Ative a sincronização ou exporte um backup.')+'</div></div>'
      + '<button class="btn ghost full" data-act="exportBackup">Exportar backup</button>'
      + '<label class="btn ghost full filebtn">Importar backup<input type="file" id="impFile" accept="application/json,.json"></label>'
      + scaleBlock()
      + syncBlock()
      + '<button class="btn ghost full" data-act="openSheet" data-kind="pw">Alterar senha</button>'
      + '<button class="btn full" data-act="logout">Sair da conta</button>'
      + '<button class="btn ghost danger full" data-act="openSheet" data-kind="del">Excluir esta conta</button>');
  }
  function sheetPw(){
    return sheetWrap('Alterar senha',
      '<label class="fld full">Senha atual<input id="pwCur" type="password" autocomplete="current-password"></label>'
      + '<label class="fld full">Nova senha<input id="pwNew" type="password" autocomplete="new-password" placeholder="Mínimo de 6 caracteres"></label>'
      + '<label class="fld full">Confirmar nova senha<input id="pwNew2" type="password" autocomplete="new-password" data-enter="savePw"></label>'
      + '<p class="msg full" id="sheetErr" role="alert"></p>'
      + '<button class="btn full" data-act="savePw">Alterar senha</button>');
  }
  function sheetDel(){
    return sheetWrap('Excluir conta',
      '<p class="small muted full" style="margin:0">Isso apaga a conta e todos os dados dela neste aparelho, sem volta. Exporte um backup antes se quiser guardar algo.</p>'
      + '<label class="fld full">Senha<input id="delPw" type="password" autocomplete="current-password" data-enter="confirmDel"></label>'
      + '<p class="msg full" id="sheetErr" role="alert"></p>'
      + '<button class="btn danger full" style="background:var(--neg);color:#fff" data-act="confirmDel">Excluir conta</button>');
  }

  var SHEETS = {sync:sheetSync, acct:sheetAcct, word:sheetWord, task:sheetTask, habit:sheetHabit, item:sheetItem, tx:sheetTx, goal:sheetGoal, account:sheetAccount, pw:sheetPw, del:sheetDel};
  var LISTS = {acct:'accounts', word:'words', task:'tasks', habit:'habits', item:'items', tx:'tx', goal:'goals'};

  function openSheet(kind, id){
    var f = SHEETS[kind]; if(!f) return;
    editing = id || null;
    var o = (id && LISTS[kind]) ? byId(state[LISTS[kind]], id) : null;
    var s = $('#sheet');
    s.innerHTML = f(o);
    s.hidden = false;
    var first = s.querySelector('input:not([type="date"]):not([type="checkbox"]):not([type="file"])');
    if(first) first.focus();
  }
  function closeSheet(){ var s = $('#sheet'); s.hidden = true; s.innerHTML = ''; editing = null; }

  /* ================= ações ================= */
  function need(el){ el.classList.add('err'); if(el.focus) el.focus(); setTimeout(function(){ el.classList.remove('err'); },1400); }
  function val(id){ return $('#'+id); }
  function upsert(listName, obj){
    if(editing){
      var o = byId(state[listName], editing);
      if(o){ Object.assign(o, obj); return; }
    }
    obj.id = uid(); state[listName].push(obj);
  }

  function act(name, el){
    var id = el && el.getAttribute('data-id');
    var t, e;
    switch(name){
      /* navegação e folhas */
      case 'openMenu': openMenu(); break;
      case 'closeMenu': closeMenu(); break;
      case 'openSheet': closeMenu(); openSheet(el.getAttribute('data-kind')); break;
      case 'edit': openSheet(el.getAttribute('data-kind'), id); break;
      case 'closeSheet': closeSheet(); break;
      case 'view': openDetail(el.getAttribute('data-kind'), id); break;
      case 'goTab':
        tab = el.getAttribute('data-to'); var gd = el.getAttribute('data-date'); if(gd) wordDate = gd;
        closeSheet(); render(); window.scrollTo(0,0); break;
      case 'undo':
        if(undoSnap){ state = normalize(JSON.parse(undoSnap)); undoSnap = null; hideToast(); commit(); }
        break;
      case 'setArea': areaFilter = el.getAttribute('data-area') || ''; render(); break;
      case 'selDay': selDate = el.getAttribute('data-date'); render(); break;
      case 'goToday': selDate = today(); weekOffset = 0; render(); break;
      case 'weekPrev': case 'weekNext':
        var step = name==='weekNext' ? 1 : -1;
        weekOffset += step; selDate = ymd(addDays(parse(selDate), step*7)); render(); break;

      /* contas */
      case 'authPick': authTarget = id; authMode = 'login'; authError = ''; showForgot = false; render(); break;
      case 'authNew': authMode = 'create'; authError = ''; render(); break;
      case 'authBack': authMode = accounts.length>1 ? 'pick' : (accounts.length ? 'login' : 'create'); if(authMode==='login') authTarget = accounts[0].id; authError=''; render(); break;
      case 'forgot': showForgot = !showForgot; render(); break;
      case 'eraseAcc': eraseAccount(id); break;
      case 'logout': logout(); break;
      case 'setScale': try{ localStorage.setItem('mc:fontpx', el.getAttribute('data-v')); }catch(e){} applyScale(); openSheet('account'); break;
      case 'authSync': authMode = 'sync'; authError = ''; render(); break;
      case 'enableSync': enableSync(); break;
      case 'syncNow': syncNow().then(function(){ var sl = $('#syncLine'); if(sl) sl.textContent = syncLine(); }); break;
      case 'syncOff': syncOff(false); break;
      case 'syncWipe': syncOff(true); break;
      case 'copySql': copySql(); break;
      case 'exportBackup': exportBackup(); break;
      case 'savePw': savePw(); break;
      case 'confirmDel': confirmDel(); break;

      /* palavra do dia */
      case 'wordPrev': case 'wordNext':
        wordDate = ymd(addDays(parse(wordDate), name==='wordNext'?1:-1)); render(); break;
      case 'wordToday': wordDate = today(); render(); break;
      case 'wordGo': wordDate = el.getAttribute('data-date'); render(); window.scrollTo(0,0); break;
      case 'saveWord':
        var wr = val('wRef').value.trim(), wt = val('wText').value.trim(), wn = val('wNote').value.trim();
        if(!wr && !wt) return need(val('wText'));
        var wd = val('wDate'); if(!validDay(wd.value)) return need(wd);
        upsert('words',{ref:wr, text:wt, note:wn, date:wd.value});
        wordDate = wd.value; closeSheet(); commit(); break;
      case 'delWord': removeWith('Palavra removida.', function(){ state.words = state.words.filter(function(x){return x.id!==id;}); }); break;

      /* tarefas */
      case 'addTask': e = val('newTask'); t = e.value.trim(); if(!t) return need(e);
        state.tasks.push({id:uid(),text:t,done:false,area:areaFilter||'Geral',prio:taskPrio||'',date:(tab==='tarefas' ? (taskTab==='proximas' ? ymd(addDays(new Date(),1)) : taskTab==='concluidas'||taskTab==='todas' ? t0() : t0()) : selDate)}); qf = (tab==='tarefas'); commit(); break;
      case 'taskTab': taskTab = el.getAttribute('data-v'); render(); break;
      case 'toggleFilters': filtersOpen = !filtersOpen; render(); break;
      case 'clearFilters': areaFilter=''; taskPrio=''; taskGroup='data'; render(); break;
      case 'saveTask': e = val('tkText'); t = e.value.trim(); if(!t) return need(e);
        var tkd = val('tkDate').value; if(tkd && !validDay(tkd)) return need(val('tkDate'));
        var prevTask = editing ? byId(state.tasks, editing) : null;
        upsert('tasks',{text:t, area:val('tkArea').value, prio:val('tkPrio').value, course:(val('tkCourse')||{}).value||'', date:val('tkDate').value||'', done:prevTask?prevTask.done:false});
        closeSheet(); commit(); break;
      case 'preset':
        var pv = el.getAttribute('data-v'), want = pv==='all' ? [0,1,2,3,4,5,6] : pv==='util' ? [1,2,3,4,5] : [0,6];
        Array.prototype.forEach.call(document.querySelectorAll('#hbDays input'), function(i){ i.checked = want.indexOf(+i.value)>-1; i.closest('.pill').classList.toggle('on', i.checked); });
        break;
      case 'habWeekPrev': habWeek--; render(); break;
      case 'habWeekNext': habWeek++; render(); break;
      case 'finPeriod': finPeriod = el.getAttribute('data-v'); finDay = ''; render(); break;
      case 'realizeTx': t = byId(state.tx,id); if(t){ t.planned = false; } commit(); break;
      case 'facCourse': facCourse = id || ''; render(); break;
      case 'facDay': var fd = el.getAttribute('data-date'); facDay = (facDay===fd) ? '' : fd; render(); break;
      case 'facPrev': case 'facNext':
        var fy = +facMonth.slice(0,4), fm = +facMonth.slice(5,7) + (name==='facNext'?1:-1), fnd = new Date(fy,fm-1,1);
        facMonth = fnd.getFullYear()+'-'+pad(fnd.getMonth()+1); facDay = ''; render(); break;
      case 'toggleTask': t = byId(state.tasks,id); t.done = !t.done; commit(); break;
      case 'delTask': removeWith('Tarefa removida.', function(){ state.tasks = state.tasks.filter(function(x){return x.id!==id;}); }); break;
      case 'clearDone': removeWith('Concluídas removidas.', function(){ state.tasks = state.tasks.filter(function(x){return !x.done;}); }); break;

      /* hábitos */
      case 'saveHabit': e = val('hbName'); t = e.value.trim(); if(!t) return need(e);
        var sched = Array.prototype.map.call(document.querySelectorAll('#hbDays input:checked'), function(i){return +i.value;});
        if(!sched.length) return need(val('hbDays'));
        var prevHb = editing ? byId(state.habits,editing) : null;
        upsert('habits',{name:t, area:val('hbArea').value, sched:sched, days:prevHb?prevHb.days:[], created:prevHb?(prevHb.created||''):today()});
        closeSheet(); commit(); break;
      case 'toggleHabit':
        t = byId(state.habits,id); var dk = el.getAttribute('data-date');
        t.days = t.days.indexOf(dk)>-1 ? t.days.filter(function(x){return x!==dk;}) : t.days.concat(dk);
        commit(); break;
      case 'delHabit': removeWith('Hábito removido.', function(){ state.habits = state.habits.filter(function(x){return x.id!==id;}); }); break;

      /* metas */
      case 'saveGoal':
        e = val('gName'); t = e.value.trim(); if(!t) return need(e);
        var tg = parseMoney(val('gTarget').value); if(!(tg>0)) return need(val('gTarget'));
        var glink = val('gLink').value;
        var gbase = 0;
        if(glink){
          var rawBase = val('gBase').value.trim();
          gbase = rawBase==='' ? 0 : parseMoney(rawBase);
          if(!isFinite(gbase)) return need(val('gBase'));
        }
        var sp = glink ? 1 : parseMoney(val('gStep').value); if(!(sp>0)) return need(val('gStep'));
        if(val('gDue').value && !validDay(val('gDue').value)) return need(val('gDue'));
        var prevGoal = editing ? byId(state.goals,editing) : null;
        var cur = prevGoal ? ((goalLinked(prevGoal) && !glink) ? goalCurrent(prevGoal) : prevGoal.current) : 0;
        upsert('goals',{name:t, target:tg, step:sp, unit:glink?'R$':val('gUnit').value.trim(), area:val('gArea').value, due:val('gDue').value, current:cur, link:glink, base:Math.round(gbase*100)/100});
        closeSheet(); commit(); break;
      case 'goalPlus': t = byId(state.goals,id); t.current = Math.round((t.current+t.step)*100)/100; commit(); break;
      case 'goalMinus': t = byId(state.goals,id); t.current = Math.max(0, Math.round((t.current-t.step)*100)/100); commit(); break;
      case 'delGoal': removeWith('Meta removida.', function(){ state.goals = state.goals.filter(function(x){return x.id!==id;}); }); break;

      /* faculdade */
      case 'addCourse': e = val('newCourse'); t = e.value.trim(); if(!t) return need(e);
        state.courses.push({id:uid(),name:t}); commit(); break;
      case 'delCourse': removeWith('Matéria removida.', function(){
          state.courses = state.courses.filter(function(x){return x.id!==id;});
          state.items.forEach(function(i){ if(i.course===id) i.course=''; });
          state.tasks.forEach(function(x){ if(x.course===id) x.course=''; });
          if(facCourse===id) facCourse='';
        }); break;
      case 'saveItem':
        e = val('itTitle'); t = e.value.trim(); if(!t) return need(e);
        var dt = val('itDate'); if(!validDay(dt.value)) return need(dt);
        var prevDone = editing ? !!(byId(state.items,editing)||{}).done : false;
        upsert('items',{kind:val('itKind').value, course:val('itCourse').value, title:t, date:dt.value, done:prevDone});
        closeSheet(); commit(); break;
      case 'toggleItem': t = byId(state.items,id); t.done = !t.done; commit(); break;
      case 'delItem': removeWith('Prazo removido.', function(){ state.items = state.items.filter(function(x){return x.id!==id;}); }); break;

      /* finanças */
      case 'saveTx':
        var amt = parseMoney(val('txAmt').value); if(!(amt>0)) return need(val('txAmt'));
        var dd = val('txDate'); if(!validDay(dd.value)) return need(dd);
        var ty = val('txType').value, ac = val('txAcct').value, to = val('txTo').value;
        if(ty==='transfer'){
          if(!ac) return need(val('txAcct'));
          if(!to || to===ac) return need(val('txTo'));
        }
        upsert('tx',{type:ty, amount:Math.round(amt*100)/100, desc:val('txDesc').value.trim(),
          cat:ty==='transfer' ? 'Transferência' : val('txCat').value, date:dd.value, account:ac, to:ty==='transfer'?to:'', planned:ty==='transfer' ? false : val('txPlanned').checked});
        finMonth = dd.value.slice(0,7); if(finDay && finDay!==dd.value) finDay = ''; closeSheet(); commit(); break;
      case 'finView': finView = el.getAttribute('data-v'); acctView = ''; finDay = ''; render(); break;
      case 'toggleFold': var fk = el.getAttribute('data-k'); fold[fk] = !fold[fk]; render(); break;
      case 'toggleDay': var dk2 = el.getAttribute('data-key'); closedDays[dk2] = !closedDays[dk2]; render(); break;
      case 'clearDay': finDay = ''; render(); break;
      case 'pickDay': var pd = el.getAttribute('data-date'); finDay = (finDay===pd) ? '' : pd; render(); break;
      case 'dayToday': finMonth = today().slice(0,7); finDay = today(); render(); break;
      case 'acctOpen': finView = 'contas'; acctView = id; acctPeriod = 'all'; finDay = ''; render(); window.scrollTo(0,0); break;
      case 'acctBack': acctView = ''; finDay = ''; render(); window.scrollTo(0,0); break;
      case 'acctAll': acctPeriod = 'all'; render(); break;
      case 'acctMonth': acctPeriod = 'month'; render(); break;
      case 'saveAcct':
        e = val('acName'); t = e.value.trim(); if(!t) return need(e);
        var rawOpen = val('acOpen').value.trim(), op = rawOpen==='' ? 0 : parseMoney(rawOpen);
        if(!isFinite(op)) return need(val('acOpen'));
        var kd = val('acKind').value, kinfo = ACCT_KINDS.filter(function(x){return x[0]===kd;})[0];
        upsert('accounts',{name:t, kind:kd, cls:kinfo?kinfo[1]:'ativo', opening:Math.round(op*100)/100});
        closeSheet(); commit(); break;
      case 'delAcct': removeWith('Conta removida.', function(){
          state.goals.forEach(function(g){ if(g.link===id){ g.current = goalCurrent(g); g.link = ''; } });
          state.accounts = state.accounts.filter(function(x){return x.id!==id;});
          state.tx.forEach(function(x){ if(x.account===id) x.account=''; if(x.to===id) x.to=''; });
          acctView = '';
        }); break;
      case 'delTx': removeWith('Lançamento removido.', function(){ state.tx = state.tx.filter(function(x){return x.id!==id;}); }); break;
      case 'monthPrev': case 'monthNext':
        var stp = finPeriod==='ano' ? 12 : 1, yy = +finMonth.slice(0,4), mm = +finMonth.slice(5,7) + (name==='monthNext'?stp:-stp);
        var nd = new Date(yy,mm-1,1); finMonth = nd.getFullYear()+'-'+pad(nd.getMonth()+1); finDay = ''; render(); break;
    }
  }

  /* ================= eventos ================= */
  document.addEventListener('click', function(ev){
    var tb = ev.target.closest('[data-tab]');
    if(tb){ tab = tb.getAttribute('data-tab'); closeMenu(); render(); window.scrollTo(0,0); return; }
    var a = ev.target.closest('[data-act]');
    if(a) act(a.getAttribute('data-act'), a);
  });
  document.addEventListener('keydown', function(ev){
    if(ev.key==='Escape'){ closeSheet(); closeMenu(); return; }
    if((ev.key==='n' || ev.key==='N') && !ev.ctrlKey && !ev.metaKey && !ev.altKey && session && $('#sheet').hidden){
      var tg = ev.target.tagName;
      if(tg!=='INPUT' && tg!=='TEXTAREA' && tg!=='SELECT'){
        var cb = document.querySelector('.cta .btn');
        if(cb){ ev.preventDefault(); cb.click(); return; }
      }
    }
    var de = ev.target.getAttribute && ev.target.getAttribute('data-enter');
    if(ev.key==='Enter' && de){ ev.preventDefault(); act(de, ev.target); }
  });
  document.addEventListener('submit', function(ev){
    var kind = ev.target.getAttribute && ev.target.getAttribute('data-form');
    if(!kind) return;
    ev.preventDefault();
    if(kind==='login') doLogin(ev.target); else if(kind==='create') doCreate(ev.target); else if(kind==='sync') doSyncLogin(ev.target);
  });
  document.addEventListener('change', function(ev){
    var el = ev.target;
    var tf = el.getAttribute && el.getAttribute('data-tf');
    if(tf){ if(tf==='area') areaFilter = el.value; else if(tf==='prio') taskPrio = el.value; else taskGroup = el.value; render(); return; }
    if(el.id==='gLink'){
      var glk = !!el.value;
      $('#fldBase').hidden = !glk; $('#noteBase').hidden = !glk; $('#fldUnit').hidden = glk; $('#fldStep').hidden = glk;
      return;
    }
    if(el.id==='txType'){
      var trf = el.value==='transfer';
      $('#fldCat').hidden = trf; $('#fldTo').hidden = !trf; $('#txAcctLbl').textContent = trf ? 'De' : 'Conta';
      return;
    }
    var pill = el.closest && el.closest('.pill');
    if(pill){ pill.classList.toggle('on', el.checked); return; }
    if(el.id==='impFile' && el.files && el.files[0]){ importBackup(el.files[0]); el.value=''; return; }
    if(el.getAttribute && el.getAttribute('data-change')==='goalSet'){
      var g = byId(state.goals, el.getAttribute('data-id')), n = parseFloat(el.value);
      if(g && isFinite(n)){ g.current = n; commit(); }
    }
  });
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState==='hidden' && dirty){ clearTimeout(saveTimer); flush(); }
    if(document.visibilityState==='visible') syncNow();
  });

  /* ================= início ================= */
  async function boot(){
    applyScale();
    loadAccounts(); initAuthMode();
    if(cryptoOk){
      try{
        var s = await idbGet('session');
        if(s && s.key){
          var acc = byId(accounts, s.id);
          if(acc){ await startSession(acc, s.key, true); return; }
        }
      }catch(e){ try{ await idbDel('session'); }catch(_){} }
    }
    render();
  }
  if(window.matchMedia){
    var mq = window.matchMedia('(min-width:900px)');
    var onMq = function(e){ if(e.matches) closeMenu(); };
    if(mq.addEventListener) mq.addEventListener('change', onMq);
  }
  window.addEventListener('online', function(){ syncNow(); });
  setInterval(function(){ if(syncRec && document.visibilityState==='visible') syncNow(); }, 45000);
  boot();

  if('serviceWorker' in navigator && !window.__TAURI_INTERNALS__){
    window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); });
  }
})();

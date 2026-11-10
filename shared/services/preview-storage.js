// Preview-only compatibility for opaque sandbox frames. The original generated
// HTML stays untouched on disk. Each document gets isolated, ephemeral stores;
// this shim never accesses the parent, cookies, the network, or host storage.
export const PREVIEW_STORAGE_SHIM = `<script data-pg-preview-storage>
(function(){
  function memoryStorage(){
    var values = new Map();
    var methods = {
      getItem:function(key){ key=String(key); return values.has(key)?values.get(key):null; },
      setItem:function(key,value){ values.set(String(key),String(value)); },
      removeItem:function(key){ values.delete(String(key)); },
      clear:function(){ values.clear(); },
      key:function(index){ return Array.from(values.keys())[Number(index)>>>0]??null; }
    };
    return new Proxy(Object.create(null),{
      get:function(_,key){
        if(key===Symbol.toStringTag)return 'Storage';
        if(key==='length')return values.size;
        if(Object.prototype.hasOwnProperty.call(methods,key))return methods[key];
        return typeof key==='string'&&values.has(key)?values.get(key):undefined;
      },
      set:function(_,key,value){ if(typeof key==='string')values.set(key,String(value));return true; },
      deleteProperty:function(_,key){ values.delete(String(key));return true; },
      ownKeys:function(){return Array.from(values.keys());},
      has:function(_,key){return key==='length'||Object.prototype.hasOwnProperty.call(methods,key)||values.has(key);},
      getOwnPropertyDescriptor:function(_,key){return values.has(key)?{configurable:true,enumerable:true,writable:true,value:values.get(key)}:undefined;}
    });
  }
  var replaced=[];
  ['localStorage','sessionStorage'].forEach(function(name){
    try { window[name].getItem('__pg_preview_probe__'); return; } catch(e){}
    try {
      var storage=memoryStorage();
      Object.defineProperty(window,name,{configurable:true,get:function(){return storage;}});
      replaced.push(name);
    } catch(e){}
  });
  if(!replaced.length)return;
  window.__PG_PREVIEW_STORAGE__={mode:'memory',stores:replaced.slice(),persistent:false};
  function notice(){
    if(!document.body)return;
    var host=document.createElement('div');
    host.setAttribute('data-pg-preview-storage-note','');
    host.style.cssText='position:fixed!important;bottom:6px!important;right:6px!important;z-index:2147483647!important;pointer-events:none!important;';
    var root=host.attachShadow?host.attachShadow({mode:'closed'}):host;
    var note=document.createElement('span');
    note.textContent='Stockage temporaire de cet aperçu · effacé au rechargement';
    note.style.cssText='display:block;padding:5px 8px;background:#18212fee;color:#fff;border:1px solid #74839b;border-radius:5px;font:11px/1.4 system-ui,sans-serif;max-width:320px;';
    root.appendChild(note);document.body.appendChild(host);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',notice,{once:true});
  else notice();
})();
<\/script>`.replace(/\n\s*/g, '');

export function withPreviewStorage(html) {
  if (!html) return html;
  if (html.includes(PREVIEW_STORAGE_SHIM)) return html;
  // Before any generated script, while keeping the doctype first (standards mode).
  const doctype = String(html).match(/^\s*<!doctype[^>]*>/i);
  return doctype ? html.slice(0, doctype[0].length) + PREVIEW_STORAGE_SHIM + html.slice(doctype[0].length)
    : PREVIEW_STORAGE_SHIM + html;
}

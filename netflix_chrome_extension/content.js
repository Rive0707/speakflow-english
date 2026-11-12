(() => {
  if (window.__speakflowNetflixInstalled) return;
  window.__speakflowNetflixInstalled = true;
  let lastText = '';
  let lastSaved = '';
  let saveButton = null;
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  function getCaptionNode() {
    const nodes = [...document.querySelectorAll('.player-timedtext-text-container, .player-timedtext-text')];
    return nodes.find(n => clean(n.innerText || n.textContent)) || null;
  }
  function getCaption() {
    const node = getCaptionNode();
    if (!node) return null;
    const text = clean(node.innerText || node.textContent);
    if (!text) return null;
    const video = document.querySelector('video');
    return { node, text, time: video && Number.isFinite(video.currentTime) ? video.currentTime : 0 };
  }
  function ensureButton() {
    if (saveButton && document.contains(saveButton)) return;
    saveButton = document.createElement('button');
    saveButton.textContent = '＋ SpeakFlowに保存';
    saveButton.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:19%;transform:translateX(-50%);padding:9px 14px;border:1px solid #91baff;border-radius:999px;background:#101827;color:#fff;font:700 13px system-ui;box-shadow:0 2px 14px #0009;cursor:pointer;display:none';
    saveButton.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); saveCurrent(); });
    document.documentElement.appendChild(saveButton);
  }
  function toast(msg, ok=true) {
    ensureButton(); saveButton.textContent = msg;
    saveButton.style.background = ok ? '#173b32' : '#512d2d';
    saveButton.style.display = 'block';
    setTimeout(() => { if (saveButton) { saveButton.textContent = '＋ SpeakFlowに保存'; saveButton.style.background='#101827'; } }, 2200);
  }
  async function saveCurrent() {
    const cap = getCaption();
    if (!cap) { toast('字幕が見つかりません', false); return; }
    if (cap.text === lastSaved) { toast('この字幕は保存済みです'); return; }
    const cfg = await chrome.storage.sync.get(['apiBase','token']);
    if (!cfg.apiBase) { toast('拡張機能の設定でSpeakFlow URLを入力', false); return; }
    const videoTitle = clean(document.title.replace(/\s*[-|]\s*Netflix.*$/i,'')) || 'Netflix';
    const h = Math.floor(cap.time/3600), m = Math.floor((cap.time%3600)/60), sec = Math.floor(cap.time%60);
    const stamp = [h,m,sec].map(n=>String(n).padStart(2,'0')).join(':');
    const phrase = {id:'netflix-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),en:cap.text,ja:'',context:`Netflix · ${videoTitle} · ${stamp}`,vid:'',t:cap.time,title:videoTitle,created:new Date().toISOString(),source:'netflix'};
    const headers={'Content-Type':'application/json'};
    if(cfg.token) headers['X-SpeakFlow-Token']=cfg.token;
    try {
      const r=await fetch(cfg.apiBase.replace(/\/$/,'')+'/api/phrases',{method:'POST',headers,body:JSON.stringify({phrases:[phrase]})});
      const data=await r.json();
      if(!r.ok) throw new Error(data.detail||'API error');
      lastSaved=cap.text; toast('SpeakFlowに保存しました ✓');
    } catch(e) { toast('保存失敗：URL・同期トークンを確認', false); console.error('SpeakFlow save failed',e); }
  }
  function observe() {
    ensureButton();
    const cap=getCaption();
    if(cap) {
      lastText=cap.text;
      saveButton.style.display='block';
      // The visible caption itself is clickable to save.
      const node=cap.node;
      if(!node.dataset.speakflowBound) {
        node.dataset.speakflowBound='1';
        node.style.cursor='pointer';
        node.title='クリックしてSpeakFlowに保存';
        node.addEventListener('click', e=>{e.preventDefault();e.stopPropagation();saveCurrent();}, true);
      }
    } else {
      if(saveButton && !saveButton.textContent.includes('保存しました') && !saveButton.textContent.includes('失敗')) saveButton.style.display='none';
    }
  }
  const mo=new MutationObserver(observe);
  mo.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  setInterval(observe,800);
  ensureButton();
})();
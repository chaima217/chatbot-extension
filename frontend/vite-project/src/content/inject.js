// inject.js
(function () {
  if (window.__chat_ext_injected) return;
  window.__chat_ext_injected = true;

  // Floating bubble
  const btn = document.createElement('div');
  btn.className = 'cex-bubble';
  btn.textContent = '💬';
  btn.title = 'Open Chatbot';
  document.body.appendChild(btn);

  // iframe wrapper
  const wrap = document.createElement('div');
  wrap.className = 'cex-frame-wrap';
  wrap.style.display = 'none';

  const iframe = document.createElement('iframe');
  iframe.className = 'cex-frame';
  iframe.src = chrome.runtime.getURL('index.html'); // built React app
  wrap.appendChild(iframe);
  document.body.appendChild(wrap);

  let open = false;
  btn.addEventListener('click', () => {
    open = !open;
    wrap.style.display = open ? 'block' : 'none';
  });
})();

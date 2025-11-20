// inject.js - VERSION MIS À JOUR
(function () {
  if (window.__chat_ext_injected) return;
  window.__chat_ext_injected = true;

  let bubbleVisible = false;
  let chatOpen = false;

  // Styles CSS
  const style = document.createElement('style');
  style.textContent = `
    .cex-bubble {
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      width: 60px !important;
      height: 60px !important;
      border-radius: 50% !important;
      background: #2563eb !important;
      color: white !important;
      display: none !important; /* Caché au début */
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      z-index: 10000 !important;
      font-size: 24px !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
      transition: transform 0.2s ease !important;
    }
    
    .cex-bubble:hover {
      transform: scale(1.1) !important;
    }
    
    .cex-frame-wrap {
      position: fixed !important;
      bottom: 90px !important;
      right: 20px !important;
      width: 360px !important;
      height: 500px !important;
      z-index: 9999 !important;
      border-radius: 12px !important;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3) !important;
      overflow: hidden !important;
      display: none !important;
    }
    
    .cex-frame {
      width: 100% !important;
      height: 100% !important;
      border: none !important;
      border-radius: 12px !important;
    }
  `;
  document.head.appendChild(style);

  // Créer la bulle
  const btn = document.createElement('div');
  btn.className = 'cex-bubble';
  btn.textContent = '💬';
  btn.title = 'Open Chatbot';
  document.body.appendChild(btn);

  // Créer l'iframe pour l'interface de chat
  const wrap = document.createElement('div');
  wrap.className = 'cex-frame-wrap';

  const iframe = document.createElement('iframe');
  iframe.className = 'cex-frame';
  iframe.src = chrome.runtime.getURL('index.html');
  wrap.appendChild(iframe);
  document.body.appendChild(wrap);

  // Quand on clique sur la bulle
  btn.addEventListener('click', () => {
    chatOpen = !chatOpen;
    wrap.style.display = chatOpen ? 'block' : 'none';
    console.log('🔵 Chat', chatOpen ? 'ouvert' : 'fermé');
  });

  // Écouter les messages de l'extension (quand on clique sur l'icône)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📨 Message reçu:', request);
    
    if (request.action === "toggleBubble") {
      bubbleVisible = !bubbleVisible;
      btn.style.display = bubbleVisible ? 'flex' : 'none';
      console.log('💬 Bulle', bubbleVisible ? 'affichée' : 'cachée');
      
      // Répondre pour confirmer
      sendResponse({ success: true, visible: bubbleVisible });
    }
    
    if (request.action === "showBubble") {
      bubbleVisible = true;
      btn.style.display = 'flex';
      console.log('💬 Bulle affichée');
      sendResponse({ success: true });
    }
    
    if (request.action === "hideBubble") {
      bubbleVisible = false;
      btn.style.display = 'none';
      wrap.style.display = 'none';
      chatOpen = false;
      console.log('💬 Bulle cachée');
      sendResponse({ success: true });
    }
    
    return true; // Garde le canal ouvert pour sendResponse
  });

  // Log pour confirmer que l'injection a réussi
  console.log('🔧 ChromeAI Assistant injecté avec succès!');
  
  // Afficher automatiquement la bulle après 1 seconde (optionnel)
  setTimeout(() => {
    // bubbleVisible = true;
    // btn.style.display = 'flex';
    // console.log('💬 Bulle affichée automatiquement');
  }, 1000);

})();
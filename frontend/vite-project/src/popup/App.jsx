import React, { useState, useEffect, useRef } from "react";

const BACKEND_URL = "http://localhost:3000/chat"; // ✅ FIXED: Removed extra space

export default function App() {
  const [messages, setMessages] = useState([{ role: "bot", text: "Hi! Ask me anything." }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text) return;

    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setLoading(true);

    try {
      // ✅ FIXED: Using GET endpoint with SSE (streaming)
      const eventSource = new EventSource(`${BACKEND_URL}?q=${encodeURIComponent(text)}`);
      let reply = "";
      let images = [];

      // Add empty bot message that will be updated
      setMessages((m) => [...m, { role: "bot", text: "", images: [] }]);

      eventSource.onmessage = (event) => {
        if (event.data === "[DONE]") {
          eventSource.close();
          setLoading(false);
          return;
        }

        let parsed;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          console.warn("Non-JSON SSE data:", event.data);
          return;
        }

        setMessages((prev) => {
          const updated = [...prev];
          const botMessage = { ...updated[updated.length - 1] };

          if (parsed.token) {
            reply += parsed.token;
            botMessage.text = reply;
          }

          if (parsed.images) {
            images = parsed.images;
            botMessage.images = images;
          }

          updated[updated.length - 1] = botMessage;
          return updated;
        });
      };

      eventSource.onerror = (err) => {
        console.error("SSE error:", err);
        eventSource.close();
        setLoading(false);
        setMessages((m) => {
          const updated = [...m];
          updated[updated.length - 1] = { 
            role: "bot", 
            text: "❌ Connection error. Make sure backend is running on http://localhost:3000" 
          };
          return updated;
        });
      };
    } catch (e) {
      console.error("Frontend error:", e);
      setMessages((m) => [...m, { role: "bot", text: "❌ Failed to reach backend: " + e.message }]);
      setLoading(false);
    }
  }

  return (
    <div style={{ 
      width: 360, 
      height: 500, 
      display: "flex", 
      flexDirection: "column", 
      fontFamily: "Inter, system-ui, Arial, sans-serif", 
      background: "#0f172a", 
      color: "#e2e8f0", 
      borderRadius: 12, 
      overflow: "hidden" 
    }}>
      {/* Header */}
      <div style={{ 
        padding: 12, 
        borderBottom: "1px solid #1f2937", 
        background: "#111827" 
      }}>
        <strong>ChromeAI Assistant</strong>
      </div>

      {/* Messages */}
      <div 
        className="chat-messages" 
        style={{ 
          flex: 1, 
          padding: 12, 
          display: "flex", 
          flexDirection: "column", 
          gap: 8,
          overflowY: "auto" 
        }}
      >
        {messages.map((m, i) => (
          <div 
            key={i} 
            style={{ 
              alignSelf: m.role === "user" ? "flex-end" : "flex-start", 
              background: m.role === "user" ? "#2563eb" : "#334155", 
              color: "#fff", 
              padding: "8px 10px", 
              borderRadius: 12, 
              maxWidth: "85%", 
              display: "flex", 
              flexDirection: "column", 
              gap: 6 
            }}
          >
            <div>{m.text}</div>
            
            {/* ✅ FIXED: Better image display with error handling */}
            {m.images?.length > 0 && (
              <div style={{ 
                display: "grid", 
                gridTemplateColumns: m.images.length === 1 ? "1fr" : "repeat(2, 1fr)", 
                gap: 6, 
                marginTop: 4 
              }}>
                {m.images.map((img, idx) => (
                  <img 
                    key={idx} 
                    src={`http://localhost:3000${img.url}`} 
                    alt={img.filename} 
                    style={{ 
                      width: "100%",
                      borderRadius: 8, 
                      objectFit: "cover",
                      cursor: "pointer",
                      maxHeight: 150
                    }}
                    onClick={() => window.open(`http://localhost:3000${img.url}`, '_blank')}
                    onError={(e) => {
                      console.error('Image failed to load:', img.url);
                      e.target.style.display = 'none';
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        
        {loading && (
          <div style={{ 
            alignSelf: "flex-start", 
            background: "#334155", 
            color: "#fff", 
            padding: "8px 10px", 
            borderRadius: 12 
          }}>
            <div style={{ display: "flex", gap: 4 }}>
              <div className="dot" style={{ animation: "pulse 1.4s infinite" }}>●</div>
              <div className="dot" style={{ animation: "pulse 1.4s infinite 0.2s" }}>●</div>
              <div className="dot" style={{ animation: "pulse 1.4s infinite 0.4s" }}>●</div>
            </div>
          </div>
        )}
        
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ 
        display: "flex", 
        gap: 8, 
        padding: 10, 
        borderTop: "1px solid #1f2937", 
        background: "#111827" 
      }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && send()}
          placeholder={loading ? "Waiting for reply…" : "Type a message…"}
          disabled={loading}
          style={{ 
            flex: 1, 
            padding: "10px 12px", 
            borderRadius: 10, 
            border: "1px solid #1f2937", 
            background: "#0b1220", 
            color: "#e5e7eb",
            outline: "none"
          }}
        />
        <button 
          onClick={send} 
          disabled={loading || !input.trim()} 
          style={{ 
            padding: "10px 14px", 
            borderRadius: 10, 
            border: "none", 
            cursor: loading || !input.trim() ? "not-allowed" : "pointer", 
            background: loading || !input.trim() ? "#475569" : "#2563eb", 
            color: "#fff",
            fontWeight: 500
          }}
        >
          {loading ? "..." : "Send"}
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 60%, 100% { opacity: 0.3; }
          30% { opacity: 1; }
        }
        .chat-messages::-webkit-scrollbar {
          width: 6px;
        }
        .chat-messages::-webkit-scrollbar-track {
          background: #1f2937;
        }
        .chat-messages::-webkit-scrollbar-thumb {
          background: #475569;
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}
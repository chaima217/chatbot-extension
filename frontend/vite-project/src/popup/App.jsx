import React, { useState, useEffect, useRef } from "react";

const BACKEND_URL = "http://localhost:3000/chat";

export default function App() {
  const [messages, setMessages] = useState([{ role: "bot", text: "Hi! Ask me anything." }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

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
      const eventSource = new EventSource(`${BACKEND_URL}?q=${encodeURIComponent(text)}`);
      let reply = "";
      let images = [];

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
        setMessages((m) => [...m, { role: "bot", text: "❌ Failed to connect to server" }]);
      };
    } catch (e) {
      console.error("Frontend error:", e);
      setMessages((m) => [...m, { role: "bot", text: "❌ Failed to reach backend" }]);
      setLoading(false);
    }
  }

  return (
    <div style={{ width: 360, height: 500, display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, Arial, sans-serif", background: "#0f172a", color: "#e2e8f0", borderRadius: 12, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: 12, borderBottom: "1px solid #1f2937", background: "#111827" }}>
        <strong>Chatbot</strong>
      </div>

      {/* Messages */}
      <div className="chat-messages" style={{ flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", background: m.role === "user" ? "#2563eb" : "#334155", color: "#fff", padding: "8px 10px", borderRadius: 12, maxWidth: "85%", display: "flex", flexDirection: "column", gap: 6 }}>
            <div>{m.text}</div>
            {m.images?.length > 0 && m.images.map((img, idx) => (
              <img key={idx} src={`http://localhost:3000${img.url}`} alt={img.filename} style={{ maxWidth: "100%", borderRadius: 8, marginTop: 4, objectFit: "contain" }} />
            ))}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid #1f2937", background: "#111827" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={loading ? "Waiting for reply…" : "Type a message…"}
          disabled={loading}
          style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #1f2937", background: "#0b1220", color: "#e5e7eb" }}
        />
        <button onClick={send} disabled={loading} style={{ padding: "10px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: loading ? "#475569" : "#2563eb", color: "#fff" }}>
          Send
        </button>
      </div>
    </div>
  );
}

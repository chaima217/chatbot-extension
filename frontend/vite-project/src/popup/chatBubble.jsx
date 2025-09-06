import React, { useState } from "react";
import App from "./App.jsx";

export default function ChatBubble() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating chat icon */}
      {!open && (
        <div
          onClick={() => setOpen(true)}
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            width: 60,
            height: 60,
            borderRadius: "50%",
            backgroundColor: "#2563eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            cursor: "pointer",
            zIndex: 9999,
            transition: "all 0.3s ease",
          }}
        >
          💬
        </div>
      )}

      {/* Chat window */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            width: 360,
            height: 500,
            borderRadius: 12,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            zIndex: 9999,
            backgroundColor: "#fff",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              backgroundColor: "#2563eb",
              color: "#fff",
              padding: "10px 16px",
              borderTopLeftRadius: 12,
              borderTopRightRadius: 12,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Chatbot</span>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "#fff",
                fontSize: 18,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>

          {/* Chat content */}
          <div
            style={{
              flex: 1,
              minHeight: 0, // Ensures flexbox child can shrink
              padding: 10,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              scrollBehavior: "smooth", // Smooth scrolling
            }}
            className="chat-content"
          >
            <App />
          </div>
        </div>
      )}
    </>
  );
}

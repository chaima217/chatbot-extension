import React, { useState } from "react";
import App from "./App.jsx";

export default function ChatBubble() {
  const [open, setOpen] = useState(false);

  return (
    <>
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
          }}
        >
          💬
        </div>
      )}

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
          }}
        >
          <App />
        </div>
      )}
    </>
  );
}

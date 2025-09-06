import React from "react";

export default function ChatMessage({ message }) {
  return (
    <div style={{ alignSelf: message.role === "user" ? "flex-end" : "flex-start", background: message.role === "user" ? "#2563eb" : "#334155", color: "#fff", padding: "8px 10px", borderRadius: 12, maxWidth: "85%", display: "flex", flexDirection: "column", gap: 6 }}>
      <div>{message.text}</div>
      {message.images?.length > 0 &&
        message.images.map((img, idx) => (
          <img key={idx} src={`http://localhost:3000${img.url}`} alt={img.filename} style={{ maxWidth: "100%", borderRadius: 8, marginTop: 4, objectFit: "contain" }} />
        ))}
    </div>
  );
}

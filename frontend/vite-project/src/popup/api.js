export async function streamChat(query, onToken, onImages, onDone, onError) {
  try {
    const eventSource = new EventSource(`http://localhost:3000/chat?q=${encodeURIComponent(query)}`);
    let reply = "";

    eventSource.onmessage = (event) => {
      if (event.data === "[DONE]") {
        eventSource.close();
        onDone();
        return;
      }
      const parsed = JSON.parse(event.data);
      if (parsed.token) onToken(parsed.token);
      if (parsed.images) onImages(parsed.images);
    };

    eventSource.onerror = (err) => {
      eventSource.close();
      onError(err);
    };
  } catch (err) {
    onError(err);
  }
}

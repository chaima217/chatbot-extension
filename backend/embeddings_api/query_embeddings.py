# embeddings_api/query_embeddings.py
import sys
import json
from sentence_transformers import SentenceTransformer, util

# Load local embedding model
model = SentenceTransformer("all-MiniLM-L6-v2")

def get_embedding(text: str):
    """Generate normalized embedding locally using sentence-transformers."""
    if not text.strip():
        return []
    embedding = model.encode(text, convert_to_tensor=True)
    embedding = util.normalize_embeddings(embedding)  # ✅ normalize correctly
    return embedding.cpu().tolist()  # JSON serializable


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No query provided"}))
        sys.exit(1)

    query = sys.argv[1]
    embedding = get_embedding(query)
    print(json.dumps({"embedding": embedding}))

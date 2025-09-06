import { exec } from 'child_process';
import { search } from './search.js';

function getEmbeddingFromPython(query) {
  return new Promise((resolve, reject) => {
    exec(`python embeddings_api/query_embeddings.py "${query}"`, (error, stdout, stderr) => {
      if (error) return reject(error);
      if (stderr) return reject(stderr);

      const lines = stdout.split('\n');
      const embeddingLine = lines.find(line => line.startsWith('[')); // looks for array output
      if (!embeddingLine) return reject("No embedding found in output");
      
      const embedding = JSON.parse(embeddingLine);
      resolve(embedding);
    });
  });
}

async function testSearch() {
  const query = "Explain the main topic of page 88";

  try {
    const queryEmbedding = await getEmbeddingFromPython(query);
    console.log("Query embedding received:", queryEmbedding.slice(0, 10), "..."); // print first 10 numbers
    const results = await search(queryEmbedding);
    console.log("Top search results:", results);
  } catch (err) {
    console.error("Error:", err);
  }
}

testSearch();

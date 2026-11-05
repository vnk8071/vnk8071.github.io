/* Shared configuration for the ⌘K palette and the "Ask my profile" chat window.
   This replaces the inline #cmdk-config block the Jekyll build used to emit on every page.
   The object below is valid JSON so scripts/build-kb.mjs can read the suggestions. */
window.__CMDK_CONFIG__ = {
  "kb": "/assets/data/kb.json",
  "worker": "/assets/js/palette.worker.js",
  "baseurl": "",
  "ask": "https://khoispace-ask.nguyenkhoi8071.workers.dev/api/ask",
  "chatbot": true,
  "semantic": "auto",
  "semanticWindow": 0.05,
  "transformers": "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm",
  "model": "Xenova/multilingual-e5-small",
  "dtype": "q8",
  "modelMb": 120,
  "queryPrefix": "query: ",
  "passagePrefix": "passage: ",
  "suggestions": [
    "Tóm tắt thế mạnh cốt lõi trong 3 gạch đầu dòng",
    "Các dự án nào đã từng triển khai thực tế ở môi trường Production?",
    "Stack công nghệ chính khi làm việc với Computer Vision & LLM?"
  ]
};

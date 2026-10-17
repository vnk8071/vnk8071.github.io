---
title: "Unified AI Runtime (UAIRT)"
collection: projects
permalink: /unified-ai-runtime/
excerpt: "One C API over QNN, ONNX Runtime, TFLite, CoreML, llama.cpp, TensorRT, OpenVINO and NCNN"
date: 2026-10-07
---

# Unified AI Runtime (UAIRT) ⚙️

[**Repo**](https://github.com/vnk8071/unified-ai-runtime) | [**PyPI**](https://pypi.org/project/uairt/)

One C API to run compiled AI models on QNN (Qualcomm NPUs), ONNX Runtime, TFLite,
CoreML, llama.cpp (GGUF language models), TensorRT, OpenVINO and NCNN. Write the
application code once; choose the backend by name when you create an engine.

UAIRT loads artifacts that each vendor's toolchain already produced and runs them
through that vendor's runtime. It does not convert or quantize models, and a
device or SDK mismatch returns an error instead of silently falling back to the CPU.

## Highlights
- Plain C ABI with a plugin per backend, so other languages can bind to it
- Python bindings: `AutoModel.from_file("model.onnx", device="cpu")`
- Stateful session API for language models (`.gguf`) with token streaming
- llama.cpp device selection — CUDA, Vulkan, OpenCL, Hexagon NPU
- Verified against each vendor's own tool on real hardware (Snapdragon, Apple M5, NVIDIA, Intel)

## Tech stack
- **Core:** C / C++, CMake
- **Bindings:** Python (wheels on PyPI), Rust
- **Backends:** QNN, ONNX Runtime, TFLite, CoreML, llama.cpp, TensorRT, OpenVINO, NCNN

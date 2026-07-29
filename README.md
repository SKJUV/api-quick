# ⚡ api-quick

> **High-Performance Multi-Interface HTTP Engine, Automation & API Workbench**
> *CLI / Interactive TUI / React Web Workbench / Headless CI Automation*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Bun Compatibility](https://img.shields.io/badge/Bun-1.0+-black?logo=bun)]()
[![Node Compatibility](https://img.shields.io/badge/Node-v20+-green?logo=node.js)]()

`api-quick` is a zero-latency, polyglot API workbench designed for modern developers and high-throughput CI/CD pipelines. It bridges the gap between ultra-fast terminal execution (`curl` / `httpie` speed) and visual interactive workbenches (`Postman` / `Insomnia`), without compromising memory footprint or security.

---

## 🔬 Key Architectural Highlights

- **⚡ Sub-10ms Cold Start**: Instant CLI execution powered by optimized runtime bootstrapping.
- **🔒 Hardware-Backed Zero-Latency Storage**: Encrypted token & session persistence (`AES-256-GCM` + OS Keychain / Argon2id fallback + SQLite WAL).
- **🚀 Polyglot Route Sniffing**: Automatic static endpoint discovery from your local source code (`Express`, `NestJS`, `FastAPI`, `Go Gin`).
- **🌐 Dual Execution Engine**: Runs natively via Bun or seamlessly falls back to Node.js / Undici.
- **📊 Declarative CI DSL**: Built-in JSONPath & EBNF assertion engine with strict POSIX exit code alignment for automated testing.
- **🔄 Universal Polyglot Exporter**: Transpile CLI invocations into production-ready code in 8 languages (`curl`, `TypeScript`, `Python`, `Go`, `Rust`, `Java`, `C#`, `PHP`).
- **🎨 Modern Interactive Interfaces**: Rich ANSI streaming CLI, interactive TUI terminal mode, and lightweight React/Vite local Web UI with zero-CORS proxying.

---

## 📦 Installation

### Via Universal Install Script (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/SKJUV/api-quick/main/install.sh | sh
```

### Via NPM
```bash
npm install -g api-quick
```

### Via Bun
```bash
bun install -g api-quick
```

---

## 🚀 Quick Start

### 1. Simple HTTP Requests
```bash
# GET Request with auto-formatted JSON streaming
api-quick GET https://api.github.com/repos/SKJUV/api-quick

# POST Request with form-encoded payload
api-quick POST https://api.stripe.com/v1/charges amount=2000 currency=usd

# POST Request with raw JSON payload
api-quick POST https://api.example.com/users name:="Alice" role:="ADMIN"
```

### 2. Polyglot Code Transpilation (`--to`)
Convert any live CLI request directly into production code:
```bash
api-quick POST https://api.stripe.com/v1/charges amount=2000 --to python
```

*Generated output:*
```python
import requests

url = "https://api.stripe.com/v1/charges"
payload = {"amount": "2000"}
headers = {"Content-Type": "application/x-www-form-urlencoded"}

response = requests.post(url, data=payload, headers=headers)
print(response.status_code)
print(response.json())
```

### 3. CI/CD Assertion Engine (`--expect-*`)
Run zero-dependency automated API tests in CI pipelines:
```bash
api-quick GET https://api.staging.example.com/health \
  --expect-status 200 \
  --expect-max-time 150ms \
  --expect-json "$.status" = "OK"
```

### 4. Interactive Terminal UI (TUI)
Simply type `api-quick` without arguments to launch the full zero-flicker TUI workbench:
```bash
api-quick
```

### 5. Local Web UI & Proxy Server
Launch the companion React Web UI with local CORS-bypass proxy:
```bash
api-quick web --port 4000
```

---

## 🛠️ Monorepo Structure

```
api-quick/
├── .github/              # CI/CD Workflows & Issue Templates
├── bin/                  # Global Executable Wrappers
├── src/                  # Core TypeScript / Bun Source Code
│   ├── cli/              # Argument Parsing, ANSI Formatter, TUI, Assertions
│   ├── core/             # HTTP Engine, Crypto, SQLite WAL, OpenAPI, AST Sniffer
│   ├── server/           # CORS Bypass Proxy (Hono) & WS IPC Server
│   └── types/            # Strict TypeScript Interfaces
├── web/                  # Vite + React + Tailwind CSS Web UI
├── tests/                # Unit, Integration & E2E Test Suite
├── LICENSE               # MIT License
└── package.json          # Monorepo Configuration
```

---

## 🤝 Contributing

We welcome contributions of all kinds! Please review our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

---

## 📜 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more details.

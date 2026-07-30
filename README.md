# api-quick

> **High-Performance Multi-Interface HTTP Engine, Automation & API Workbench**  
> *CLI / Interactive TUI / Web Workbench / Headless CI Automation*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![NPM Version](https://img.shields.io/npm/v/@skjuve/api-quick.svg)](https://www.npmjs.com/package/@skjuve/api-quick)
[![Documentation](https://img.shields.io/badge/Documentation-Online-brightgreen.svg)](https://www.sineng-juvenal.me)

Official Documentation Website: **[https://www.sineng-juvenal.me](https://www.sineng-juvenal.me)**  
*Alternative mirror*: **[https://quick-cli.vercel.app](https://quick-cli.vercel.app)**

`api-quick` is a zero-latency, polyglot API workbench designed for modern developers and high-throughput CI/CD pipelines. It bridges the gap between ultra-fast terminal execution (`curl` / `httpie` speed) and visual interactive workbenches (`Postman` / `Insomnia`), without compromising memory footprint or security.

---

## Architectural Highlights

- **Sub-10ms Cold Start**: Instant CLI execution powered by optimized runtime bootstrapping.
- **Polyglot AST Route Sniffing**: Automatic static endpoint discovery from your local source code (`Express`, `NestJS`, `Next.js`, `FastAPI`, `Flask`, `Django`, `Go`, `Spring Boot`, `Laravel`).
- **OpenAPI 3.0 Generation**: Automatic Swagger-style documentation and specification export (`/api/openapi.json`).
- **E2E Workflow Runner**: Multi-step request chaining with automatic JWT token extraction and variable propagation.
- **High-Throughput Load Benchmark**: Concurrent HTTP load testing engine computing p50, p95, and p99 latency percentiles.
- **Zero-Latency Mock API Server**: Instant local mock server (`api-quick mock`) serving structured payloads.
- **Structural JSON Diff Engine**: Visual structural diffing (`api-quick diff`) comparing keys across environments.
- **Declarative CI Assertions**: Built-in JSONPath assertion engine with POSIX exit code alignment for automated testing.
- **Universal Polyglot Exporter**: Transpile requests into production code in 8 languages (`curl`, `TypeScript`, `Python`, `Go`, `Rust`, `Java`, `C#`, `PHP`).
- **Web Workbench with CORS Bypass Proxy**: Responsive Web UI featuring Theme Switcher (Dark / Light / OLED), security level filtering, and execution telemetry logs.

---

## Installation

### Via NPM
```bash
npm install -g @skjuve/api-quick
```

### Direct Execution via NPX
```bash
npx @skjuve/api-quick web
```

---

## Quick Start & Usage

### 1. HTTP Request Execution
```bash
# GET Request with auto-formatted JSON streaming
api-quick GET https://api.github.com/repos/SKJUV/api-quick

# POST Request with form-encoded payload
api-quick POST https://api.stripe.com/v1/charges amount=2000 currency=usd

# POST Request with JSON payload
api-quick POST https://api.example.com/users name:="Alice" role:="ADMIN"
```

### 2. Code Transpilation (`--to`)
Convert any live CLI request directly into production code:
```bash
api-quick POST https://api.stripe.com/v1/charges amount=2000 --to python
```

*Output:*
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
api-quick GET https://api.example.com/health \
  --expect-status 200 \
  --expect-max-time 150ms \
  --expect-json "$.status" = "OK"
```

### 4. Direct CLI Commands

| Command | Description |
| :--- | :--- |
| `api-quick web [--port 4000]` | Launch Web UI Workbench with CORS bypass proxy |
| `api-quick tui` | Launch interactive Terminal UI workbench |
| `api-quick sniff [dir]` | Scan local source code AST for API routes |
| `api-quick bench <url> -n 100 -c 10` | Run high-throughput HTTP load benchmark |
| `api-quick mock [--port 8080]` | Launch zero-latency AST mock API server |
| `api-quick diff <url1> <url2>` | Visual structural JSON diffing engine |

---

## Directory Structure

```
api-quick/
├── bin/                  # Global CLI Executable Wrappers
├── docs/                 # Official Documentation Platform Website
├── src/                  # Core TypeScript Source Code
│   ├── cli/              # Argument Parsing, ANSI Formatter, TUI, Assertions
│   ├── core/             # HTTP Engine, AST Sniffer, Workflows, Benchmark, Mock, Diff
│   ├── server/           # CORS Bypass Proxy (Hono) & Web UI Server
│   └── types/            # TypeScript Interface Definitions
├── tests/                # Unit & Integration Test Suite
├── LICENSE               # MIT License
└── package.json          # Monorepo Configuration
```

---

## Contributing

Contributions of all kinds are welcome! Please review our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before submitting pull requests.

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more details.

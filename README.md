# curlgen

[![npm version](https://img.shields.io/npm/v/@lxgicstudios/curlgen.svg)](https://www.npmjs.com/package/@lxgicstudios/curlgen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Convert between cURL commands, JavaScript fetch, and axios code. Works both directions. Also supports Postman collection import.

## Install

```bash
npm install -g @lxgicstudios/curlgen
```

Or run directly:

```bash
npx @lxgicstudios/curlgen "curl https://api.example.com"
```

## Features

- **cURL to fetch** - Turn any cURL command into clean fetch code
- **cURL to axios** - Generate axios requests from cURL
- **fetch to cURL** - Reverse convert fetch code back to cURL
- **axios to cURL** - Turn axios configs into cURL commands
- **Postman import** - Convert entire Postman collections at once
- **Auto-detection** - It'll figure out what format you're giving it
- **Pipe-friendly** - Works great with stdin for scripting
- **JSON output** - Get the parsed request as structured data
- **Zero dependencies** - Built with Node.js builtins only

## Usage

```bash
# cURL to fetch (default)
curlgen "curl -X POST https://api.example.com -H 'Content-Type: application/json' -d '{\"name\":\"test\"}'"

# cURL to axios
curlgen --to axios "curl https://api.example.com -H 'Authorization: Bearer token'"

# Fetch code to cURL
curlgen --to curl --from fetch "const r = await fetch('https://api.example.com', { method: 'POST' })"

# Postman collection
curlgen --file collection.json --from postman --all

# Pipe from clipboard or file
pbpaste | curlgen --to axios
cat request.txt | curlgen

# JSON output
curlgen --json "curl -X POST https://api.example.com -d 'data'"
```

## Options

| Option | Description |
|--------|-------------|
| `--to <format>` | Output format: `fetch`, `axios`, `curl` (default: `fetch`) |
| `--from <format>` | Input format: `curl`, `fetch`, `axios`, `postman` (auto-detected) |
| `--file <path>` | Read input from a file |
| `--json` | Output parsed request as JSON |
| `--all` | Convert all requests from Postman collection |
| `--help` | Show help |
| `--version` | Show version |

## Supported cURL Flags

curlgen handles these cURL flags correctly:

- `-X, --request` - HTTP method
- `-H, --header` - Request headers
- `-d, --data` - Request body
- `--data-raw, --data-binary` - Raw/binary data
- `--data-urlencode` - URL-encoded data
- `-u, --user` - Basic auth credentials
- `-A, --user-agent` - User agent string
- `-b, --cookie` - Cookies
- `-e, --referer` - Referer header
- `-L, --location` - Follow redirects
- `-k, --insecure` - Skip SSL verification
- `--compressed` - Accept compressed response

---

**Built by [LXGIC Studios](https://lxgicstudios.com)**

[GitHub](https://github.com/lxgicstudios/curlgen) | [Twitter](https://x.com/lxgicstudios)

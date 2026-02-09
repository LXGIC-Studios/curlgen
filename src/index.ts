#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
};

interface ParsedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  contentType?: string;
  auth?: { user: string; pass: string };
  followRedirects: boolean;
  insecure: boolean;
}

// ─── cURL Parser ───

function parseCurl(input: string): ParsedRequest {
  // Normalize multiline curl commands (backslash continuation)
  const normalized = input.replace(/\\\n\s*/g, ' ').trim();

  // Remove leading "curl" if present
  const cmdStr = normalized.replace(/^curl\s+/, '');

  const tokens = tokenize(cmdStr);

  const result: ParsedRequest = {
    method: 'GET',
    url: '',
    headers: {},
    followRedirects: true,
    insecure: false,
  };

  let explicitMethod = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];

    switch (token) {
      case '-X':
      case '--request':
        if (next) {
          result.method = next.toUpperCase();
          explicitMethod = true;
          i++;
        }
        break;

      case '-H':
      case '--header':
        if (next) {
          const colonIdx = next.indexOf(':');
          if (colonIdx > 0) {
            const key = next.substring(0, colonIdx).trim();
            const value = next.substring(colonIdx + 1).trim();
            result.headers[key] = value;
            if (key.toLowerCase() === 'content-type') {
              result.contentType = value;
            }
          }
          i++;
        }
        break;

      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
        if (next) {
          result.body = next;
          if (!explicitMethod) result.method = 'POST';
          i++;
        }
        break;

      case '--data-urlencode':
        if (next) {
          result.body = result.body ? result.body + '&' + next : next;
          if (!explicitMethod) result.method = 'POST';
          if (!result.contentType) {
            result.contentType = 'application/x-www-form-urlencoded';
            result.headers['Content-Type'] = result.contentType;
          }
          i++;
        }
        break;

      case '-u':
      case '--user':
        if (next) {
          const [user, pass] = next.split(':');
          result.auth = { user, pass: pass || '' };
          i++;
        }
        break;

      case '-L':
      case '--location':
        result.followRedirects = true;
        break;

      case '-k':
      case '--insecure':
        result.insecure = true;
        break;

      case '-A':
      case '--user-agent':
        if (next) {
          result.headers['User-Agent'] = next;
          i++;
        }
        break;

      case '-b':
      case '--cookie':
        if (next) {
          result.headers['Cookie'] = next;
          i++;
        }
        break;

      case '-e':
      case '--referer':
        if (next) {
          result.headers['Referer'] = next;
          i++;
        }
        break;

      case '--compressed':
        if (!result.headers['Accept-Encoding']) {
          result.headers['Accept-Encoding'] = 'gzip, deflate, br';
        }
        break;

      default:
        // If it looks like a URL, capture it
        if (!token.startsWith('-') && (token.startsWith('http') || token.startsWith('/'))) {
          result.url = token;
        }
        break;
    }
  }

  return result;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && !inSingle) {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (ch === ' ' && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

// ─── Code Generators ───

function toFetch(req: ParsedRequest): string {
  const lines: string[] = [];

  const hasOptions = req.method !== 'GET' || Object.keys(req.headers).length > 0 || req.body || req.auth;

  if (req.auth) {
    lines.push(`const credentials = btoa('${req.auth.user}:${req.auth.pass}');`);
    lines.push('');
  }

  if (!hasOptions) {
    lines.push(`const response = await fetch('${req.url}');`);
  } else {
    lines.push(`const response = await fetch('${req.url}', {`);
    lines.push(`  method: '${req.method}',`);

    const headers = { ...req.headers };
    if (req.auth) {
      headers['Authorization'] = '${`Basic ${credentials}`}';
    }

    if (Object.keys(headers).length > 0) {
      lines.push('  headers: {');
      for (const [key, value] of Object.entries(headers)) {
        if (key === 'Authorization' && req.auth) {
          lines.push(`    'Authorization': \`Basic \${credentials}\`,`);
        } else {
          lines.push(`    '${key}': '${value.replace(/'/g, "\\'")}',`);
        }
      }
      lines.push('  },');
    }

    if (req.body) {
      // Try to detect JSON
      try {
        JSON.parse(req.body);
        lines.push(`  body: JSON.stringify(${req.body}),`);
      } catch {
        lines.push(`  body: '${req.body.replace(/'/g, "\\'")}',`);
      }
    }

    lines.push('});');
  }

  lines.push('');
  lines.push('const data = await response.json();');
  lines.push('console.log(data);');

  return lines.join('\n');
}

function toAxios(req: ParsedRequest): string {
  const lines: string[] = [];

  lines.push("import axios from 'axios';");
  lines.push('');

  const config: string[] = [];

  if (req.method === 'GET' && !req.body && Object.keys(req.headers).length === 0 && !req.auth) {
    lines.push(`const { data } = await axios.get('${req.url}');`);
    lines.push('console.log(data);');
    return lines.join('\n');
  }

  config.push(`  method: '${req.method.toLowerCase()}',`);
  config.push(`  url: '${req.url}',`);

  if (Object.keys(req.headers).length > 0) {
    config.push('  headers: {');
    for (const [key, value] of Object.entries(req.headers)) {
      config.push(`    '${key}': '${value.replace(/'/g, "\\'")}',`);
    }
    config.push('  },');
  }

  if (req.auth) {
    config.push('  auth: {');
    config.push(`    username: '${req.auth.user}',`);
    config.push(`    password: '${req.auth.pass}',`);
    config.push('  },');
  }

  if (req.body) {
    try {
      JSON.parse(req.body);
      config.push(`  data: ${req.body},`);
    } catch {
      config.push(`  data: '${req.body.replace(/'/g, "\\'")}',`);
    }
  }

  lines.push(`const { data } = await axios({`);
  lines.push(config.join('\n'));
  lines.push('});');
  lines.push('');
  lines.push('console.log(data);');

  return lines.join('\n');
}

function toCurl(req: ParsedRequest): string {
  const parts: string[] = ['curl'];

  if (req.method !== 'GET') {
    parts.push(`-X ${req.method}`);
  }

  parts.push(`'${req.url}'`);

  for (const [key, value] of Object.entries(req.headers)) {
    parts.push(`-H '${key}: ${value}'`);
  }

  if (req.auth) {
    parts.push(`-u '${req.auth.user}:${req.auth.pass}'`);
  }

  if (req.body) {
    parts.push(`-d '${req.body}'`);
  }

  if (req.insecure) {
    parts.push('-k');
  }

  return parts.join(' \\\n  ');
}

// ─── Fetch/Axios to ParsedRequest (reverse) ───

function parseFetchCode(code: string): ParsedRequest {
  const result: ParsedRequest = {
    method: 'GET',
    url: '',
    headers: {},
    followRedirects: true,
    insecure: false,
  };

  // Extract URL
  const urlMatch = code.match(/fetch\s*\(\s*['"`]([^'"`]+)['"`]/);
  if (urlMatch) result.url = urlMatch[1];

  // Extract method
  const methodMatch = code.match(/method\s*:\s*['"`](\w+)['"`]/);
  if (methodMatch) result.method = methodMatch[1].toUpperCase();

  // Extract headers
  const headersBlock = code.match(/headers\s*:\s*\{([^}]+)\}/s);
  if (headersBlock) {
    const headerEntries = headersBlock[1].matchAll(/['"`]([^'"`]+)['"`]\s*:\s*['"`]([^'"`]+)['"`]/g);
    for (const match of headerEntries) {
      result.headers[match[1]] = match[2];
    }
  }

  // Extract body
  const bodyStringMatch = code.match(/body\s*:\s*['"`]([^'"`]+)['"`]/);
  const bodyJsonMatch = code.match(/body\s*:\s*JSON\.stringify\s*\(([^)]+)\)/s);
  if (bodyJsonMatch) {
    result.body = bodyJsonMatch[1].trim();
  } else if (bodyStringMatch) {
    result.body = bodyStringMatch[1];
  }

  return result;
}

function parseAxiosCode(code: string): ParsedRequest {
  const result: ParsedRequest = {
    method: 'GET',
    url: '',
    headers: {},
    followRedirects: true,
    insecure: false,
  };

  // Simple get
  const simpleGet = code.match(/axios\.get\s*\(\s*['"`]([^'"`]+)['"`]/);
  if (simpleGet) {
    result.url = simpleGet[1];
    return result;
  }

  // Simple post
  const simplePost = code.match(/axios\.post\s*\(\s*['"`]([^'"`]+)['"`]/);
  if (simplePost) {
    result.url = simplePost[1];
    result.method = 'POST';
  }

  // Config-based
  const urlMatch = code.match(/url\s*:\s*['"`]([^'"`]+)['"`]/);
  if (urlMatch) result.url = urlMatch[1];

  const methodMatch = code.match(/method\s*:\s*['"`](\w+)['"`]/);
  if (methodMatch) result.method = methodMatch[1].toUpperCase();

  const headersBlock = code.match(/headers\s*:\s*\{([^}]+)\}/s);
  if (headersBlock) {
    const headerEntries = headersBlock[1].matchAll(/['"`]([^'"`]+)['"`]\s*:\s*['"`]([^'"`]+)['"`]/g);
    for (const match of headerEntries) {
      result.headers[match[1]] = match[2];
    }
  }

  const authBlock = code.match(/auth\s*:\s*\{([^}]+)\}/s);
  if (authBlock) {
    const userMatch = authBlock[1].match(/username\s*:\s*['"`]([^'"`]+)['"`]/);
    const passMatch = authBlock[1].match(/password\s*:\s*['"`]([^'"`]+)['"`]/);
    if (userMatch) {
      result.auth = { user: userMatch[1], pass: passMatch ? passMatch[1] : '' };
    }
  }

  const dataMatch = code.match(/data\s*:\s*(['"`]([^'"`]+)['"`]|\{[^}]+\})/s);
  if (dataMatch) {
    result.body = dataMatch[2] || dataMatch[1];
  }

  return result;
}

// ─── Postman Collection Parser ───

interface PostmanItem {
  name: string;
  request: {
    method: string;
    url: { raw?: string; protocol?: string; host?: string[]; path?: string[] } | string;
    header?: Array<{ key: string; value: string }>;
    body?: {
      mode: string;
      raw?: string;
      urlencoded?: Array<{ key: string; value: string }>;
      formdata?: Array<{ key: string; value: string }>;
    };
    auth?: {
      type: string;
      basic?: Array<{ key: string; value: string }>;
    };
  };
  item?: PostmanItem[];
}

function parsePostmanCollection(json: string): ParsedRequest[] {
  const collection = JSON.parse(json);
  const items: PostmanItem[] = [];

  function flattenItems(itemList: PostmanItem[]): void {
    for (const item of itemList) {
      if (item.item) {
        flattenItems(item.item);
      } else if (item.request) {
        items.push(item);
      }
    }
  }

  if (collection.item) {
    flattenItems(collection.item);
  }

  return items.map((item): ParsedRequest => {
    const req = item.request;
    let url = '';

    if (typeof req.url === 'string') {
      url = req.url;
    } else if (req.url?.raw) {
      url = req.url.raw;
    } else if (req.url) {
      const protocol = req.url.protocol || 'https';
      const host = req.url.host?.join('.') || 'localhost';
      const path = req.url.path?.join('/') || '';
      url = `${protocol}://${host}/${path}`;
    }

    const headers: Record<string, string> = {};
    if (req.header) {
      for (const h of req.header) {
        headers[h.key] = h.value;
      }
    }

    let body: string | undefined;
    if (req.body) {
      if (req.body.mode === 'raw' && req.body.raw) {
        body = req.body.raw;
      } else if (req.body.mode === 'urlencoded' && req.body.urlencoded) {
        body = req.body.urlencoded.map(p => `${p.key}=${p.value}`).join('&');
      }
    }

    let auth: { user: string; pass: string } | undefined;
    if (req.auth?.type === 'basic' && req.auth.basic) {
      const userEntry = req.auth.basic.find(e => e.key === 'username');
      const passEntry = req.auth.basic.find(e => e.key === 'password');
      if (userEntry) {
        auth = { user: userEntry.value, pass: passEntry?.value || '' };
      }
    }

    return {
      method: req.method || 'GET',
      url,
      headers,
      body,
      auth,
      followRedirects: true,
      insecure: false,
    };
  });
}

// ─── Auto-detect input type ───

type InputType = 'curl' | 'fetch' | 'axios' | 'postman' | 'unknown';

function detectType(input: string): InputType {
  const trimmed = input.trim();
  if (trimmed.startsWith('curl ') || trimmed.startsWith('curl\n')) return 'curl';

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.info && parsed.item) return 'postman';
  } catch {
    // not JSON
  }

  if (trimmed.includes('fetch(') || trimmed.includes('fetch (')) return 'fetch';
  if (trimmed.includes('axios')) return 'axios';

  return 'unknown';
}

// ─── CLI ───

function printHelp(): void {
  console.log(`
${c.bgBlue}${c.white}${c.bold} curlgen ${c.reset} ${c.dim}v1.0.0${c.reset}

${c.bold}Convert between cURL, fetch, and axios code${c.reset}

${c.yellow}USAGE${c.reset}
  ${c.cyan}curlgen${c.reset} [options] <input>
  ${c.cyan}cat curl.txt | curlgen${c.reset}

${c.yellow}OPTIONS${c.reset}
  ${c.green}--to${c.reset} <format>      Output format: fetch, axios, curl (default: fetch)
  ${c.green}--from${c.reset} <format>    Input format: curl, fetch, axios, postman (auto-detected)
  ${c.green}--file${c.reset} <path>      Read input from file
  ${c.green}--json${c.reset}             Output as JSON (parsed request object)
  ${c.green}--all${c.reset}              For Postman: convert all requests
  ${c.green}--help${c.reset}             Show this help
  ${c.green}--version${c.reset}          Show version

${c.yellow}EXAMPLES${c.reset}
  ${c.dim}# cURL to fetch${c.reset}
  curlgen "curl -X POST https://api.example.com -H 'Content-Type: application/json' -d '{\"key\":\"value\"}'"

  ${c.dim}# cURL to axios${c.reset}
  curlgen --to axios "curl https://api.example.com -H 'Authorization: Bearer token'"

  ${c.dim}# Fetch code to cURL${c.reset}
  curlgen --to curl --from fetch "const r = await fetch('https://api.example.com')"

  ${c.dim}# Postman collection to fetch${c.reset}
  curlgen --file collection.json --from postman

  ${c.dim}# Pipe input${c.reset}
  echo "curl https://api.example.com" | curlgen --to axios

  ${c.dim}# JSON output${c.reset}
  curlgen --json "curl -X POST https://api.example.com -d 'data'"
`);
}

function printVersion(): void {
  console.log('curlgen v1.0.0');
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let toFormat = 'fetch';
  let fromFormat = '';
  let filePath = '';
  let jsonOutput = false;
  let showAll = false;
  let inputParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      case '--version':
      case '-v':
        printVersion();
        process.exit(0);
        break;
      case '--to':
        toFormat = args[++i] || 'fetch';
        break;
      case '--from':
        fromFormat = args[++i] || '';
        break;
      case '--file':
      case '-f':
        filePath = args[++i] || '';
        break;
      case '--json':
        jsonOutput = true;
        break;
      case '--all':
        showAll = true;
        break;
      default:
        inputParts.push(args[i]);
        break;
    }
  }

  let input = inputParts.join(' ');

  // Read from file if specified
  if (filePath) {
    try {
      input = fs.readFileSync(path.resolve(filePath), 'utf8').trim();
    } catch (err: any) {
      console.error(`${c.red}Error:${c.reset} Can't read file: ${filePath}`);
      console.error(err.message);
      process.exit(1);
    }
  }

  // Read from stdin if no input
  if (!input) {
    input = await readStdin();
  }

  if (!input) {
    console.error(`${c.red}Error:${c.reset} No input provided. Use --help for usage.`);
    process.exit(1);
  }

  // Detect input type
  const detectedType = fromFormat || detectType(input);

  if (detectedType === 'unknown') {
    console.error(`${c.red}Error:${c.reset} Can't detect input format. Use --from to specify.`);
    process.exit(1);
  }

  // Parse input to ParsedRequest(s)
  let requests: ParsedRequest[];

  switch (detectedType) {
    case 'curl':
      requests = [parseCurl(input)];
      break;
    case 'fetch':
      requests = [parseFetchCode(input)];
      break;
    case 'axios':
      requests = [parseAxiosCode(input)];
      break;
    case 'postman':
      requests = parsePostmanCollection(input);
      if (!showAll && requests.length > 1) {
        console.log(`${c.yellow}Found ${requests.length} requests. Use --all to convert all, or showing first only.${c.reset}\n`);
        requests = [requests[0]];
      }
      break;
    default:
      console.error(`${c.red}Error:${c.reset} Unknown format: ${detectedType}`);
      process.exit(1);
  }

  // Generate output
  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];

    if (requests.length > 1) {
      console.log(`${c.cyan}${c.bold}--- Request ${i + 1} ---${c.reset}`);
      console.log(`${c.dim}${req.method} ${req.url}${c.reset}\n`);
    }

    if (jsonOutput) {
      console.log(JSON.stringify(req, null, 2));
    } else {
      let output: string;
      switch (toFormat) {
        case 'fetch':
          output = toFetch(req);
          break;
        case 'axios':
          output = toAxios(req);
          break;
        case 'curl':
          output = toCurl(req);
          break;
        default:
          console.error(`${c.red}Error:${c.reset} Unknown output format: ${toFormat}. Use fetch, axios, or curl.`);
          process.exit(1);
      }

      console.log(output);
    }

    if (i < requests.length - 1) {
      console.log();
    }
  }
}

main().catch((err) => {
  console.error(`${c.red}Error:${c.reset}`, err.message);
  process.exit(1);
});

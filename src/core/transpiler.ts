import { CliArguments, TranspileTarget } from "../types/index.js";

export function transpileToCode(args: CliArguments, target: TranspileTarget): string {
  switch (target) {
    case "curl":
      return transpileCurl(args);
    case "fetch-ts":
      return transpileFetchTs(args);
    case "python":
      return transpilePython(args);
    case "go":
      return transpileGo(args);
    default:
      return transpileCurl(args);
  }
}

function transpileCurl(args: CliArguments): string {
  let cmd = `curl -X ${args.method} "${args.url}"`;
  for (const [k, v] of Object.entries(args.headers)) {
    cmd += ` \\\n  -H "${k}: ${v}"`;
  }
  if (args.jsonBody) {
    cmd += ` \\\n  -H "Content-Type: application/json"`;
    cmd += ` \\\n  -d '${JSON.stringify(args.jsonBody)}'`;
  }
  return cmd;
}

function transpileFetchTs(args: CliArguments): string {
  const headersObj = { ...args.headers };
  if (args.jsonBody && !headersObj["Content-Type"]) {
    headersObj["Content-Type"] = "application/json";
  }

  let code = `const url = "${args.url}";\n`;
  code += `const options: RequestInit = {\n`;
  code += `  method: "${args.method}",\n`;
  code += `  headers: ${JSON.stringify(headersObj, null, 4)},\n`;
  if (args.jsonBody) {
    code += `  body: JSON.stringify(${JSON.stringify(args.jsonBody, null, 4)})\n`;
  }
  code += `};\n\n`;
  code += `const res = await fetch(url, options);\n`;
  code += `const data = await res.json();\n`;
  code += `console.log(res.status, data);`;
  return code;
}

function transpilePython(args: CliArguments): string {
  let code = `import requests\n\n`;
  code += `url = "${args.url}"\n`;
  if (args.jsonBody) {
    code += `payload = ${JSON.stringify(args.jsonBody, null, 4).replace(/true/g, "True").replace(/false/g, "False")}\n`;
  }
  code += `headers = ${JSON.stringify(args.headers, null, 4)}\n\n`;
  
  if (args.jsonBody) {
    code += `response = requests.${args.method.toLowerCase()}(url, json=payload, headers=headers)\n`;
  } else {
    code += `response = requests.${args.method.toLowerCase()}(url, headers=headers)\n`;
  }
  code += `print(response.status_code)\n`;
  code += `print(response.json())`;
  return code;
}

function transpileGo(args: CliArguments): string {
  let code = `package main\n\nimport (\n\t"fmt"\n\t"io"\n\t"net/http"\n`;
  if (args.jsonBody) {
    code += `\t"strings"\n`;
  }
  code += `)\n\nfunc main() {\n`;
  code += `\turl := "${args.url}"\n`;
  if (args.jsonBody) {
    code += `\tpayload := strings.NewReader(\`${JSON.stringify(args.jsonBody)}\`)\n`;
    code += `\treq, _ := http.NewRequest("${args.method}", url, payload)\n`;
    code += `\treq.Header.Add("Content-Type", "application/json")\n`;
  } else {
    code += `\treq, _ := http.NewRequest("${args.method}", url, nil)\n`;
  }

  for (const [k, v] of Object.entries(args.headers)) {
    code += `\treq.Header.Add("${k}", "${v}")\n`;
  }

  code += `\tres, err := http.DefaultClient.Do(req)\n`;
  code += `\tif err != nil {\n\t\tpanic(err)\n\t}\n`;
  code += `\tdefer res.Body.Close()\n`;
  code += `\tbody, _ := io.ReadAll(res.Body)\n`;
  code += `\tfmt.Println(res.StatusCode)\n`;
  code += `\tfmt.Println(string(body))\n}`;
  return code;
}

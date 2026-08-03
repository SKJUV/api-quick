import type { CliArguments, TranspileTarget } from "../types/index.js";

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
    case "rust":
      return transpileRust(args);
    case "java":
      return transpileJava(args);
    case "csharp":
      return transpileCSharp(args);
    case "php":
      return transpilePhp(args);
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

function transpileRust(args: CliArguments): string {
  let code = `use reqwest::Client;\nuse std::error::Error;\n\n`;
  code += `#[tokio::main]\nasync fn main() -> Result<(), Box<dyn Error>> {\n`;
  code += `    let client = Client::new();\n`;
  code += `    let res = client.${args.method.toLowerCase()}("${args.url}")\n`;
  for (const [k, v] of Object.entries(args.headers)) {
    code += `        .header("${k}", "${v}")\n`;
  }
  if (args.jsonBody) {
    code += `        .json(&serde_json::json!(${JSON.stringify(args.jsonBody)}))\n`;
  }
  code += `        .send()\n        .await?;\n\n`;
  code += `    println!("Status: {}", res.status());\n`;
  code += `    let body = res.text().await?;\n`;
  code += `    println!("{}", body);\n`;
  code += `    Ok(())\n}`;
  return code;
}

function transpileJava(args: CliArguments): string {
  let code = `import java.net.URI;\nimport java.net.http.HttpClient;\nimport java.net.http.HttpRequest;\nimport java.net.http.HttpResponse;\n\n`;
  code += `public class ApiRequest {\n`;
  code += `    public static void main(String[] args) throws Exception {\n`;
  code += `        HttpClient client = HttpClient.newHttpClient();\n`;
  code += `        HttpRequest.Builder builder = HttpRequest.newBuilder()\n`;
  code += `            .uri(URI.create("${args.url}"));\n\n`;

  for (const [k, v] of Object.entries(args.headers)) {
    code += `        builder.header("${k}", "${v}");\n`;
  }

  if (args.jsonBody) {
    code += `        builder.header("Content-Type", "application/json");\n`;
    code += `        builder.method("${args.method}", HttpRequest.BodyPublishers.ofString("${JSON.stringify(args.jsonBody).replace(/"/g, '\\"')}"));\n`;
  } else {
    code += `        builder.method("${args.method}", HttpRequest.BodyPublishers.noBody());\n`;
  }

  code += `\n        HttpResponse<String> response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());\n`;
  code += `        System.out.println(response.statusCode());\n`;
  code += `        System.out.println(response.body());\n`;
  code += `    }\n}`;
  return code;
}

function transpileCSharp(args: CliArguments): string {
  let code = `using System;\nusing System.Net.Http;\nusing System.Text;\nusing System.Threading.Tasks;\n\n`;
  code += `class Program {\n`;
  code += `    static async Task Main() {\n`;
  code += `        using var client = new HttpClient();\n`;
  code += `        var request = new HttpRequestMessage(HttpMethod.${args.method === "GET" ? "Get" : args.method === "POST" ? "Post" : "Put"}, "${args.url}");\n`;

  for (const [k, v] of Object.entries(args.headers)) {
    code += `        request.Headers.Add("${k}", "${v}");\n`;
  }

  if (args.jsonBody) {
    code += `        request.Content = new StringContent(@"${JSON.stringify(args.jsonBody)}", Encoding.UTF8, "application/json");\n`;
  }

  code += `        var response = await client.SendAsync(request);\n`;
  code += `        string body = await response.Content.ReadAsStringAsync();\n`;
  code += `        Console.WriteLine((int)response.StatusCode);\n`;
  code += `        Console.WriteLine(body);\n`;
  code += `    }\n}`;
  return code;
}

function transpilePhp(args: CliArguments): string {
  let code = `<?php\n\n$ch = curl_init("${args.url}");\n`;
  code += `curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "${args.method}");\n`;
  code += `curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n`;

  const headers = Object.entries(args.headers).map(([k, v]) => `"${k}: ${v}"`);
  if (args.jsonBody) {
    headers.push('"Content-Type: application/json"');
    code += `curl_setopt($ch, CURLOPT_POSTFIELDS, '${JSON.stringify(args.jsonBody)}');\n`;
  }

  if (headers.length > 0) {
    code += `curl_setopt($ch, CURLOPT_HTTPHEADER, [\n    ${headers.join(",\n    ")}\n]);\n`;
  }

  code += `$response = curl_exec($ch);\n`;
  code += `$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);\n`;
  code += `curl_close($ch);\n\n`;
  code += `echo "Status: $status\\n";\n`;
  code += `echo $response;\n`;
  return code;
}

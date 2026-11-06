// A local stand-in for the four AI providers, speaking each one's wire format
// (OpenRouter and OpenAI chat completions, Anthropic messages, Gemini
// streamGenerateContent). Debug builds point at it via ENGINEERS_NOTEBOOK_AI_HOST.
// It records every request so tests can inspect exactly what was sent.
import http from "node:http";

export function startMockAi(port = 9455) {
  const requests = [];
  let mode = { kind: "ok" }; // ok | status | slow | garbage

  const chunks = (text, size = 17) => {
    const out = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
  };

  function summaryFor(notes) {
    const dated = [
      ...notes.matchAll(/^\[(r\d+)\] (Due|Follow up|Waiting on) [^·]*· [^·]*· (.*)$/gm),
    ];
    const forgotten = notes.match(/^\[(r\d+)\] Check with dev/m);
    const sections = [];
    if (dated[0])
      sections.push({
        title: "Do these first",
        items: [
          { text: `${dated[0][3]} is overdue.`, ref: dated[0][1] },
          { text: "Invented item", ref: "r999" },
        ],
      });
    if (dated[1])
      sections.push({
        title: "Coming up",
        items: [{ text: `${dated[1][3]} is coming up.`, ref: dated[1][1] }],
      });
    if (forgotten)
      sections.push({
        title: "You might have forgotten",
        items: [{ text: "A note says Check with dev, with no date.", ref: forgotten[1] }],
      });
    return JSON.stringify({ sections });
  }

  function replyFor(system, userText) {
    if (/connection test/i.test(system)) return "OK";
    // A test supplies the answer: setMode({ kind: "reply", fn: (system, userText) => "..." }).
    if (mode.kind === "reply") return mode.fn(system, userText);
    if (mode.kind === "garbage") return "I'm sorry, here is a summary in prose rather than JSON.";
    if (system.includes("<notes>")) {
      const first = system.match(/\[(r\d+)\] (?:Due|Follow up)/);
      return `You said you would send the redirect map${first ? ` [${first[1]}]` : ""}.`;
    }
    return summaryFor(userText);
  }

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const json = body ? JSON.parse(body) : null;
      const record = {
        method: req.method,
        path: url.pathname,
        headers: req.headers,
        body: json,
        closedEarly: false,
      };

      if (url.pathname === "/__requests") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(requests));
      }
      requests.push(record);
      req.on("close", () => {
        if (!res.writableEnded) record.closedEarly = true;
      });

      if (mode.kind === "status" && req.method === "POST") {
        const m = mode;
        if (m.once) mode = { kind: "ok" };
        const headers = { "content-type": "application/json" };
        if (m.retryAfter) headers["retry-after"] = String(m.retryAfter);
        res.writeHead(m.status, headers);
        return res.end(
          JSON.stringify({
            error: { message: m.message ?? "mock error", type: m.type ?? "error" },
          }),
        );
      }

      // ----- model lists -----
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        if (url.pathname === "/api/v1/models") {
          return res.end(
            JSON.stringify({
              data: [
                {
                  id: "mock/vision-model",
                  name: "Mock Vision",
                  context_length: 200000,
                  architecture: { input_modalities: ["text", "image"] },
                },
                {
                  id: "mock/text-model",
                  name: "Mock Text",
                  context_length: 32000,
                  architecture: { input_modalities: ["text"] },
                },
              ],
            }),
          );
        }
        if (url.pathname === "/v1/models" && req.headers["anthropic-version"]) {
          return res.end(
            JSON.stringify({
              data: [
                {
                  id: "claude-mock",
                  display_name: "Claude Mock",
                  max_input_tokens: 200000,
                  lifecycle: "active",
                  capabilities: { image_input: { supported: true } },
                },
              ],
              has_more: false,
            }),
          );
        }
        if (url.pathname === "/v1/models") {
          return res.end(
            JSON.stringify({ data: [{ id: "gpt-5-mock" }, { id: "text-embedding-3-small" }] }),
          );
        }
        if (url.pathname === "/v1beta/models") {
          return res.end(
            JSON.stringify({
              models: [
                {
                  name: "models/gemini-mock",
                  displayName: "Gemini Mock",
                  inputTokenLimit: 1000000,
                  supportedGenerationMethods: ["generateContent"],
                },
              ],
            }),
          );
        }
        res.writeHead(404);
        return res.end("{}");
      }

      // ----- completions -----
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const send = (s) => res.write(s);
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      const slow = mode.kind === "slow";

      let system = "";
      let user = "";
      let style = "openai";
      if (url.pathname.endsWith("/chat/completions")) {
        system = json.messages[0].content;
        user = json.messages
          .filter((m) => m.role === "user")
          .map((m) => (typeof m.content === "string" ? m.content : m.content[0].text))
          .join("\n");
        if (url.pathname.startsWith("/api/v1")) send(": OPENROUTER PROCESSING\n\n");
      } else if (url.pathname === "/v1/messages") {
        style = "anthropic";
        system = json.system;
        user = json.messages
          .filter((m) => m.role === "user")
          .map((m) => m.content[0].text)
          .join("\n");
      } else if (url.pathname.includes(":streamGenerateContent")) {
        style = "gemini";
        system = json.systemInstruction.parts[0].text;
        user = json.contents
          .filter((c) => c.role === "user")
          .map((c) => c.parts[0].text)
          .join("\n");
      }

      const text = slow ? "x".repeat(400) : replyFor(system, user);
      if (style === "anthropic") {
        send(
          `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m", role: "assistant", content: [] } })}\n\n`,
        );
        send(
          `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
        );
        send(`event: ping\ndata: {"type":"ping"}\n\n`);
      }
      for (const piece of chunks(text)) {
        if (res.destroyed) return;
        if (style === "openai")
          send(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        if (style === "anthropic")
          send(
            `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } })}\n\n`,
          );
        if (style === "gemini")
          send(
            `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: piece }] } }] })}\r\n\r\n`,
          );
        await delay(slow ? 300 : 2);
      }
      if (style === "openai") send("data: [DONE]\n\n");
      if (style === "anthropic") send(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
      res.end();
    });
  });

  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve({
        requests,
        setMode: (m) => (mode = m),
        reset: () => requests.splice(0),
        close: () => new Promise((r) => server.close(r)),
      }),
    ),
  );
}

import { describe, it, expect } from "vitest";
import { MessageParser, encodeMessage } from "../../src/proxy/message-parser.js";
import type { JsonRpcMessage } from "../../src/proxy/types.js";

describe("MessageParser", () => {
  it("parses a single complete message", () => {
    const parser = new MessageParser();
    const messages: JsonRpcMessage[] = [];
    parser.on("message", (msg: JsonRpcMessage) => messages.push(msg));

    const msg = { jsonrpc: "2.0" as const, id: 1, method: "test" };
    parser.feed(encodeMessage(msg));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(msg);
  });

  it("handles message split across multiple chunks", () => {
    const parser = new MessageParser();
    const messages: JsonRpcMessage[] = [];
    parser.on("message", (msg: JsonRpcMessage) => messages.push(msg));

    const msg = { jsonrpc: "2.0" as const, id: 1, method: "test", params: { foo: "bar" } };
    const encoded = encodeMessage(msg);

    // Split in the middle
    const mid = Math.floor(encoded.length / 2);
    parser.feed(encoded.subarray(0, mid));
    expect(messages).toHaveLength(0);

    parser.feed(encoded.subarray(mid));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(msg);
  });

  it("handles multiple messages in a single chunk", () => {
    const parser = new MessageParser();
    const messages: JsonRpcMessage[] = [];
    parser.on("message", (msg: JsonRpcMessage) => messages.push(msg));

    const msg1 = { jsonrpc: "2.0" as const, id: 1, method: "first" };
    const msg2 = { jsonrpc: "2.0" as const, id: 2, method: "second" };

    const combined = Buffer.concat([encodeMessage(msg1), encodeMessage(msg2)]);
    parser.feed(combined);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(msg1);
    expect(messages[1]).toEqual(msg2);
  });

  it("emits error on invalid JSON", () => {
    const parser = new MessageParser();
    const errors: Error[] = [];
    parser.on("error", (err: Error) => errors.push(err));

    const badBody = "not json at all";
    const header = `Content-Length: ${Buffer.byteLength(badBody)}\r\n\r\n`;
    parser.feed(Buffer.from(header + badBody));

    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain("Failed to parse");
  });

  it("handles unicode content correctly", () => {
    const parser = new MessageParser();
    const messages: JsonRpcMessage[] = [];
    parser.on("message", (msg: JsonRpcMessage) => messages.push(msg));

    const msg = { jsonrpc: "2.0" as const, id: 1, method: "test", params: { text: "한국어 테스트 🎉" } };
    parser.feed(encodeMessage(msg));

    expect(messages).toHaveLength(1);
    expect((messages[0] as any).params.text).toBe("한국어 테스트 🎉");
  });
});

describe("encodeMessage", () => {
  it("produces valid Content-Length framing", () => {
    const msg = { jsonrpc: "2.0" as const, id: 1, method: "test" };
    const encoded = encodeMessage(msg).toString("utf-8");

    expect(encoded).toMatch(/^Content-Length: \d+\r\n\r\n/);
    const body = encoded.split("\r\n\r\n")[1]!;
    expect(JSON.parse(body)).toEqual(msg);
  });

  it("Content-Length matches byte length, not character length", () => {
    const msg = { jsonrpc: "2.0" as const, id: 1, method: "한국어" };
    const encoded = encodeMessage(msg);
    const str = encoded.toString("utf-8");
    const clMatch = /Content-Length: (\d+)/.exec(str);
    const bodyStr = str.split("\r\n\r\n")[1]!;
    const bodyBytes = Buffer.byteLength(bodyStr, "utf-8");

    expect(parseInt(clMatch![1]!, 10)).toBe(bodyBytes);
  });
});

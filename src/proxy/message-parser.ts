import { EventEmitter } from "node:events";
import type { JsonRpcMessage } from "./types.js";

/**
 * Parses JSON-RPC messages from a stdio stream using LSP-style
 * Content-Length framing.
 *
 * Format:
 *   Content-Length: <byte_length>\r\n
 *   \r\n
 *   <JSON body>
 */
export class MessageParser extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private contentLength: number | null = null;

  /** Feed raw bytes from a stream into the parser. */
  feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.parse();
  }

  private parse(): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.contentLength === null) {
        // Look for the header separator \r\n\r\n
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return; // need more data

        const header = this.buffer.subarray(0, headerEnd).toString("utf-8");
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          // Skip malformed header — advance past separator and try again
          this.buffer = this.buffer.subarray(headerEnd + 4);
          continue;
        }

        this.contentLength = parseInt(match[1]!, 10);
        this.buffer = this.buffer.subarray(headerEnd + 4);
      }

      // Check if we have the full body
      if (this.buffer.length < this.contentLength) return; // need more data

      const body = this.buffer.subarray(0, this.contentLength).toString("utf-8");
      this.buffer = this.buffer.subarray(this.contentLength);
      this.contentLength = null;

      try {
        const message = JSON.parse(body) as JsonRpcMessage;
        this.emit("message", message);
      } catch {
        this.emit("error", new Error(`Failed to parse JSON-RPC message: ${body.slice(0, 200)}`));
      }
    }
  }
}

/** Encode a JSON-RPC message with Content-Length framing. */
export function encodeMessage(message: JsonRpcMessage): Buffer {
  const body = JSON.stringify(message);
  const bodyBytes = Buffer.from(body, "utf-8");
  const header = `Content-Length: ${bodyBytes.length}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, "utf-8"), bodyBytes]);
}

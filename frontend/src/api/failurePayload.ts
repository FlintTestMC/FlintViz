import type { FailurePayload } from "./types";

export async function decodeFailurePayload(encoded: string): Promise<FailurePayload> {
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  void writer.write(bytes);
  void writer.close();

  const response = new Response(ds.readable);
  const decompressedBytes = await response.arrayBuffer();
  const decodedText = new TextDecoder().decode(decompressedBytes);
  return JSON.parse(decodedText) as FailurePayload;
}

export async function encodeFailurePayload(payload: FailurePayload): Promise<string> {
  const jsonText = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(jsonText);

  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  void writer.write(bytes);
  void writer.close();

  const response = new Response(cs.readable);
  const compressedBuffer = await response.arrayBuffer();
  const compressedBytes = new Uint8Array(compressedBuffer);

  let binaryString = "";
  for (let i = 0; i < compressedBytes.length; i++) {
    const byte = compressedBytes[i];
    if (byte !== undefined) {
      binaryString += String.fromCharCode(byte);
    }
  }
  const base64 = btoa(binaryString);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

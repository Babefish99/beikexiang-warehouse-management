const MULTIPART_BOUNDARY = "----------------codexOpeningStockBoundary7MA4YWxkTrZu0gW";

function quoted(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function multipartPayload(input: {
  fields?: Record<string, string>;
  file?: {
    fieldName?: string;
    fileName: string;
    contentType: string;
    buffer: Buffer;
  };
}): { boundary: string; headers: { "content-type": string }; payload: Buffer } {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(input.fields ?? {})) {
    parts.push(
      Buffer.from(
        `--${MULTIPART_BOUNDARY}\r\nContent-Disposition: form-data; name="${quoted(name)}"\r\n\r\n${value}\r\n`,
        "utf8",
      ),
    );
  }
  if (input.file) {
    parts.push(
      Buffer.from(
        `--${MULTIPART_BOUNDARY}\r\nContent-Disposition: form-data; name="${quoted(input.file.fieldName ?? "file")}"; filename="${quoted(input.file.fileName)}"\r\nContent-Type: ${input.file.contentType}\r\n\r\n`,
        "utf8",
      ),
      input.file.buffer,
      Buffer.from("\r\n", "utf8"),
    );
  }
  parts.push(Buffer.from(`--${MULTIPART_BOUNDARY}--\r\n`, "utf8"));
  return {
    boundary: MULTIPART_BOUNDARY,
    headers: { "content-type": `multipart/form-data; boundary=${MULTIPART_BOUNDARY}` },
    payload: Buffer.concat(parts),
  };
}

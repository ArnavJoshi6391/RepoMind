import crypto from "node:crypto";

export function verifyWebhookSignature(rawBody: Buffer | string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expectedSignature = signatureHeader.slice(7);
  const hmac = crypto.createHmac("sha256", secret);
  
  if (Buffer.isBuffer(rawBody)) {
    hmac.update(rawBody);
  } else {
    hmac.update(rawBody, "utf-8");
  }

  const calculatedSignature = hmac.digest("hex");

  try {
    const expectedBuf = Buffer.from(expectedSignature, "hex");
    const calculatedBuf = Buffer.from(calculatedSignature, "hex");

    if (expectedBuf.length !== calculatedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, calculatedBuf);
  } catch (error) {
    return false;
  }
}

export interface ParsedWebhookHeaders {
  deliveryId: string;
  eventType: string;
  signature: string;
}

export function parseWebhookHeaders(headers: Record<string, string | string[] | undefined>): ParsedWebhookHeaders | null {
  const deliveryId = Array.isArray(headers["x-github-delivery"]) ? headers["x-github-delivery"][0] : headers["x-github-delivery"];
  const eventType = Array.isArray(headers["x-github-event"]) ? headers["x-github-event"][0] : headers["x-github-event"];
  const signature = Array.isArray(headers["x-hub-signature-256"]) ? headers["x-hub-signature-256"][0] : headers["x-hub-signature-256"];

  if (!deliveryId || !eventType || !signature) {
    return null;
  }

  return {
    deliveryId,
    eventType,
    signature,
  };
}

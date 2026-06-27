(function () {
  const SALT_STR = "family-counter-telegram-v1";
  const ITERATIONS = 100000;

  async function deriveKey(familyCode, secret) {
    const material = new TextEncoder().encode(
      `${String(familyCode).trim().toUpperCase()}:${secret}`
    );
    const baseKey = await crypto.subtle.importKey(
      "raw",
      material,
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: new TextEncoder().encode(SALT_STR),
        iterations: ITERATIONS,
        hash: "SHA-256",
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptJson(familyCode, secret, payload) {
    const key = await deriveKey(familyCode, secret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    const out = new Uint8Array(iv.length + encrypted.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(encrypted), iv.length);
    return out;
  }

  async function decryptJson(familyCode, secret, data) {
    const key = await deriveKey(familyCode, secret);
    const iv = data.slice(0, 12);
    const encrypted = data.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  window.FamilyTelegramCrypto = {
    encryptJson,
    decryptJson,
  };
})();

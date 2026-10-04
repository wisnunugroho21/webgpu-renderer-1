/** Content identity for cold asset caches. Callers snapshot mutable source bytes before hashing. */
export async function contentHash(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    /** Delegates this operation to value.toString(16).padStart. */ value
      .toString(16)
      .padStart(2, "0"),
  ).join("");
}

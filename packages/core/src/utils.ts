/** True if `bytes` starts with every byte of `prefix`. */
export function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) {
    return false
  }
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) {
      return false
    }
  }
  return true
}

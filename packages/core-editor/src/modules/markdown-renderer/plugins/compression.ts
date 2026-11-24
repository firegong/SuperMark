/**
 * Runs bytes through a (De)CompressionStream. Works without Blob.stream()/Response so it also
 * runs in environments that only provide the stream classes.
 */
export async function transformBytes(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Write and read concurrently: the readable side must be drained for the write to finish.
  const write = async () => {
    await writer.write(bytes as Uint8Array<ArrayBuffer>);
    await writer.close();
  };
  const written = write();

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  await written;

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

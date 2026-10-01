// Streaming, uncompressed ZIP32 records. UTF-8 names and signed data descriptors
// follow PKWARE APPNOTE 6.3.10. Source bytes are never recompressed or transformed.
export const ZIP_LIMIT = 0xffffffff;
export const ENTRY_LIMIT = 10_000;
export const METADATA_LIMIT = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

export function crc32(data, crc = 0xffffffff) {
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return crc >>> 0;
}

export function safeComponent(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name === "." ||
    name === ".." ||
    /[\\/:\u0000-\u001f\u007f]/.test(name) ||
    decoder.decode(encoder.encode(name)) !== name
  ) {
    throw new Error("A folder contains a name that cannot be safely represented in a ZIP.");
  }
  return name;
}

export function zipEntry(name, directory, info, path) {
  const components = name.replace(/\/$/, "").split("/");
  components.forEach(safeComponent);
  const nameBytes = encoder.encode(name);
  if (nameBytes.length > 65535) throw new Error("An archive path is too long for ZIP.");
  return { name, nameBytes, directory, info, path, bytes: directory ? 0 : info.bytes };
}

export function zipBudget() {
  let bytes = 22,
    metadata = 0;
  let count = 0;
  return {
    get bytes() {
      return bytes;
    },
    add(entry) {
      if (++count > ENTRY_LIMIT)
        throw new Error("Folders with more than 10,000 ZIP entries are not supported.");
      const recordBytes = 76 + entry.nameBytes.length * 2 + (entry.directory ? 0 : 16);
      metadata += recordBytes;
      bytes += entry.bytes + recordBytes;
      if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || bytes >= ZIP_LIMIT) {
        throw new Error("This folder exceeds the ZIP32 archive limit (just under 4 GiB).");
      }
      if (metadata > METADATA_LIMIT)
        throw new Error("This folder exceeds the ZIP metadata limit (8 MiB).");
      return bytes;
    },
  };
}

export function zipSize(entries) {
  const budget = zipBudget();
  for (const entry of entries) budget.add(entry);
  return budget.bytes;
}

function record(size, signature) {
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  view.setUint32(0, signature, true);
  return { data, view };
}

export function localHeader(entry) {
  const { data, view } = record(30 + entry.nameBytes.length, 0x04034b50);
  view.setUint16(4, 20, true);
  view.setUint16(6, entry.directory ? 0x0800 : 0x0808, true);
  view.setUint16(12, 33, true); // 1980-01-01; the Remote has no modification time.
  view.setUint16(26, entry.nameBytes.length, true);
  data.set(entry.nameBytes, 30);
  return data;
}

export function descriptor(crc, bytes) {
  const { data, view } = record(16, 0x08074b50);
  view.setUint32(4, crc, true);
  view.setUint32(8, bytes, true);
  view.setUint32(12, bytes, true);
  return data;
}

export function centralHeader(entry, crc, offset) {
  const { data, view } = record(46 + entry.nameBytes.length, 0x02014b50);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, entry.directory ? 0x0800 : 0x0808, true);
  view.setUint16(14, 33, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, entry.bytes, true);
  view.setUint32(24, entry.bytes, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint32(38, entry.directory ? 0x10 : 0x20, true);
  view.setUint32(42, offset, true);
  data.set(entry.nameBytes, 46);
  return data;
}

export function endRecord(count, size, offset) {
  const { data, view } = record(22, 0x06054b50);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, size, true);
  view.setUint32(16, offset, true);
  return data;
}

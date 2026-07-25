/**
 * A minimal, DETERMINISTIC ZIP writer (STORE method — no compression). Given the same ordered entries it
 * produces byte-identical output: no compression variance, and every timestamp is pinned to a fixed DOS
 * date/time. Used for the child-safety evidence export package so a manifest hash is reproducible.
 *
 * Format: [local file header + name + data]* [central directory header + name]* [end of central directory].
 * No data descriptors, no ZIP64, no extra fields — small, forensic, fully specified.
 */
export interface ZipEntry { name: string; data: Uint8Array; }

// Precomputed CRC-32 (IEEE) table.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Fixed DOS time (00:00:00) + date (1980-01-01) so output never depends on the wall clock.
const DOS_TIME = 0;
const DOS_DATE = 0x21; // ((1980-1980)<<9) | (1<<5) | 1

/** Build a deterministic STORE-method ZIP from the given entries (in the order provided). */
export function buildDeterministicZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(0, 8);           // method 0 = store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);       // compressed size (== uncompressed for store)
    local.writeUInt32LE(size, 22);       // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);          // extra field length
    locals.push(local, Buffer.from(nameBytes), Buffer.from(e.data));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0, 8);           // flags
    central.writeUInt16LE(0, 10);          // method
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);          // extra length
    central.writeUInt16LE(0, 32);          // comment length
    central.writeUInt16LE(0, 34);          // disk number start
    central.writeUInt16LE(0, 36);          // internal attrs
    central.writeUInt32LE(0, 38);          // external attrs
    central.writeUInt32LE(offset, 42);     // local header offset
    centrals.push(central, Buffer.from(nameBytes));

    offset += local.length + nameBytes.length + size;
  }

  const centralStart = offset;
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(0, 4);          // disk number
  eocd.writeUInt16LE(0, 6);          // central dir start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);         // comment length

  return new Uint8Array(Buffer.concat([...locals, centralBytes, eocd]));
}

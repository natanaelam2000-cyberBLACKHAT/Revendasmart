import { inflateSync } from "node:zlib";

export type DecodedPng = {
  readonly width: number;
  readonly height: number;
  readonly colorType: 0 | 2 | 4 | 6;
  readonly data: Uint8Array;
};

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PRO-07F.3B-RECONCILE-DIAG §4: checagem explícita e isolada da assinatura PNG, para ser validada
 * ANTES do decode completo (em vez de só descobrir via exceção do parser de chunks). Nunca lança. */
export function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const prediction = a + b - c;
  const distanceA = Math.abs(prediction - a);
  const distanceB = Math.abs(prediction - b);
  const distanceC = Math.abs(prediction - c);
  return distanceA <= distanceB && distanceA <= distanceC ? a : distanceB <= distanceC ? b : c;
}

/** Decoder PNG mínimo e local: 8-bit, não entrelaçado, sem conversão de cor. */
export function decodePng(bytes: Uint8Array): DecodedPng {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new Error("invalid-png-signature");
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = -1;
  let colorType = -1;
  let compression = -1;
  let filterMethod = -1;
  let interlace = -1;
  const idatParts: Uint8Array[] = [];

  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const end = dataOffset + length;
    if (!Number.isSafeInteger(length) || end + 4 > bytes.length) throw new Error("invalid-png-chunk");
    const type = Buffer.from(bytes.subarray(typeOffset, typeOffset + 4)).toString("ascii");
    const data = bytes.subarray(dataOffset, end);
    if (type === "IHDR") {
      if (length !== 13) throw new Error("invalid-png-ihdr");
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      compression = data[10];
      filterMethod = data[11];
      interlace = data[12];
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }

  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error("invalid-png-dimensions");
  if (bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType) || compression !== 0 || filterMethod !== 0 || interlace !== 0) {
    throw new Error("unsupported-png-format");
  }
  if (!idatParts.length) throw new Error("missing-png-idat");

  const bytesPerPixel = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const stride = width * bytesPerPixel;
  const expectedInflatedLength = (stride + 1) * height;
  if (!Number.isSafeInteger(stride) || !Number.isSafeInteger(expectedInflatedLength)) throw new Error("png-too-large");
  const compressed = Buffer.concat(idatParts.map((part) => Buffer.from(part)));
  const inflated = inflateSync(compressed);
  if (inflated.length !== expectedInflatedLength) throw new Error("invalid-png-scanline-size");

  const output = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowInputOffset = y * (stride + 1);
    const filter = inflated[rowInputOffset];
    if (filter > 4) throw new Error("unsupported-png-filter");
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[rowInputOffset + 1 + x];
      const outputOffset = y * stride + x;
      const left = x >= bytesPerPixel ? output[outputOffset - bytesPerPixel] : 0;
      const up = y > 0 ? output[outputOffset - stride] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? output[outputOffset - stride - bytesPerPixel] : 0;
      const reconstructed = filter === 0
        ? raw
        : filter === 1
          ? raw + left
          : filter === 2
            ? raw + up
            : filter === 3
              ? raw + Math.floor((left + up) / 2)
              : raw + paeth(left, up, upLeft);
      output[outputOffset] = reconstructed & 0xff;
    }
  }

  return { width, height, colorType: colorType as DecodedPng["colorType"], data: output };
}

export function decodePngToRgba(bytes: Uint8Array): { width: number; height: number; data: Uint8ClampedArray } {
  const decoded = decodePng(bytes);
  const rgba = new Uint8ClampedArray(decoded.width * decoded.height * 4);
  const channels = decoded.colorType === 0 ? 1 : decoded.colorType === 2 ? 3 : decoded.colorType === 4 ? 2 : 4;
  for (let pixel = 0; pixel < decoded.width * decoded.height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    if (decoded.colorType === 0 || decoded.colorType === 4) {
      rgba[target] = decoded.data[source];
      rgba[target + 1] = decoded.data[source];
      rgba[target + 2] = decoded.data[source];
      rgba[target + 3] = decoded.colorType === 4 ? decoded.data[source + 1] : 255;
    } else {
      rgba[target] = decoded.data[source];
      rgba[target + 1] = decoded.data[source + 1];
      rgba[target + 2] = decoded.data[source + 2];
      rgba[target + 3] = decoded.colorType === 6 ? decoded.data[source + 3] : 255;
    }
  }
  return { width: decoded.width, height: decoded.height, data: rgba };
}

/** `channels=alpha` normalmente retorna grayscale; se vier RGBA, somente A é utilizado. */
export function decodePhotoroomAlphaPng(bytes: Uint8Array): { width: number; height: number; alpha: Uint8ClampedArray } {
  const decoded = decodePng(bytes);
  const pixelCount = decoded.width * decoded.height;
  if (decoded.colorType === 0) return { width: decoded.width, height: decoded.height, alpha: Uint8ClampedArray.from(decoded.data) };
  if (decoded.colorType !== 6) throw new Error("photoroom-mask-must-be-grayscale-or-rgba");
  const alpha = new Uint8ClampedArray(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) alpha[pixel] = decoded.data[pixel * 4 + 3];
  return { width: decoded.width, height: decoded.height, alpha };
}

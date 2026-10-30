import type { QrCodeReader } from "@app/core";
import jpeg from "jpeg-js";
import jsQR from "jsqr";
import { PNG } from "pngjs";

/**
 * Leitor de QR em JavaScript puro (sem binário nativo): decodifica a imagem para pixels e passa
 * ao jsQR. Foto torta, borrada ou com QR pequeno falha: o fluxo cai na leitura da imagem pela IA.
 */
export function createQrReader(): QrCodeReader {
  return {
    read({ bytes, contentType }) {
      try {
        const type = contentType.split(";")[0]?.trim().toLowerCase();
        let pixels: { data: ArrayLike<number>; width: number; height: number };
        if (type === "image/jpeg") {
          const decoded = jpeg.decode(Buffer.from(bytes), {
            useTArray: true,
            maxMemoryUsageInMB: 256,
          });
          pixels = { data: decoded.data, width: decoded.width, height: decoded.height };
        } else if (type === "image/png") {
          const decoded = PNG.sync.read(Buffer.from(bytes));
          pixels = { data: decoded.data, width: decoded.width, height: decoded.height };
        } else {
          return null;
        }
        const code = jsQR(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height);
        return code?.data ?? null;
      } catch {
        return null;
      }
    },
  };
}

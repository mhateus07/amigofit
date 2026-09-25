import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface PdfLine {
  text: string;
  x: number;
  y: number;
  page: number;
}

interface PdfTextNative {
  extractLines(uri: string): Promise<PdfLine[]>;
}

// Só existe no iOS (PDFKit). No Android, ou numa build antiga sem o módulo,
// devolve null e o app cai no envio do PDF inteiro.
const native = Platform.OS === 'ios' ? requireOptionalNativeModule<PdfTextNative>('PdfText') : null;

export function isPdfTextAvailable(): boolean {
  return native !== null;
}

export async function extractPdfLines(uri: string): Promise<PdfLine[]> {
  if (!native) throw new Error('Leitura de PDF no aparelho indisponível');
  return native.extractLines(uri);
}

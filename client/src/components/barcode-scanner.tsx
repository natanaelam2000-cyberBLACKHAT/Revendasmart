import { useEffect, useRef, useState } from 'react';
useEffect(() => {
  let codeReader: any;

  async function startScanner() {
    const { BrowserMultiFormatReader } =
      await import("@zxing/library");

    codeReader = new BrowserMultiFormatReader();

    codeReader.decodeFromVideoDevice(
      null,
      videoRef.current!,
      (result) => {
        if (result) {
          onScan(result.getText());
          onClose();
        }
      }
    );
  }

  startScanner();

  return () => {
    codeReader?.reset();
  };
}, [onScan, onClose]);
import { X, Camera } from 'lucide-react';

interface ScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onScan, onClose }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const codeReader = new BrowserMultiFormatReader();
    
    codeReader.decodeFromVideoDevice(null, videoRef.current!, (result, err) => {
      if (result) {
        onScan(result.getText());
        onClose();
      }
    });

    return () => {
      codeReader.reset();
    };
  }, [onScan, onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-6">
      <button 
        onClick={onClose}
        className="absolute top-8 right-8 text-white bg-white/10 p-3 rounded-full"
      >
        <X className="w-6 h-6" />
      </button>
      
      <div className="w-full aspect-square max-w-sm border-2 border-primary rounded-3xl overflow-hidden relative">
        <video ref={videoRef} className="w-full h-full object-cover" />
        <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4/5 h-0.5 bg-primary animate-pulse" />
      </div>
      
      <p className="mt-8 text-white font-bold text-center">Posicione o código de barras no centro</p>
    </div>
  );
}

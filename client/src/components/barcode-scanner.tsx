import { useEffect, useRef, useState } from "react";
import { X, Camera } from "lucide-react";

interface ScannerProps { onScan: (code: string) => void; onClose: () => void; }
export function BarcodeScanner({ onScan, onClose }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let codeReader: { reset: () => void } | undefined;
    const start = async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/library");
        if (!active || !videoRef.current) return;
        const reader = new BrowserMultiFormatReader();
        codeReader = reader;
        await reader.decodeFromVideoDevice(null, videoRef.current, (result) => {
          if (result && active) { onScan(result.getText()); onClose(); }
        });
      } catch (scanError) {
        console.error("[barcode-scanner] Camera initialization failed", scanError);
        if (active) setError("Não foi possível acessar a câmera. Digite o código manualmente.");
      }
    };
    void start();
    return () => { active = false; codeReader?.reset(); };
  }, [onScan, onClose]);
  return <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
    <button onClick={onClose} className="absolute top-[max(2rem,env(safe-area-inset-top))] right-8 text-white bg-white/10 p-3 rounded-full" aria-label="Fechar scanner"><X className="w-6 h-6" /></button>
    <div className="w-full aspect-square max-w-sm border-2 border-primary rounded-3xl overflow-hidden relative">
      <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
      <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4/5 h-0.5 bg-primary animate-pulse" />
    </div>
    {error ? <div className="mt-6 max-w-sm rounded-2xl bg-white p-4 text-center"><Camera className="mx-auto mb-2 h-5 w-5 text-primary"/><p className="text-sm font-bold">{error}</p><button onClick={onClose} className="mt-3 text-sm font-bold text-primary">Voltar</button></div> : <p className="mt-8 text-white font-bold text-center">Posicione o código de barras no centro</p>}
  </div>;
}
export default BarcodeScanner;

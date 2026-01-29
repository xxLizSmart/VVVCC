import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QrCode, X, Camera, CheckCircle, AlertCircle } from 'lucide-react';

interface QRScannerProps {
  onScan: (url: string) => void;
  onClose: () => void;
}

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedUrl, setScannedUrl] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const startScanning = async () => {
    setError(null);
    setIsScanning(true);

    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          setScannedUrl(decodedText);
          scanner.stop().catch(() => {});
          setIsScanning(false);
          
          if (navigator.vibrate) {
            navigator.vibrate(100);
          }
        },
        () => {}
      );
    } catch (err) {
      setIsScanning(false);
      if (err instanceof Error) {
        if (err.message.includes('NotAllowedError') || err.message.includes('Permission')) {
          setError('Camera permission denied. Please allow camera access.');
        } else if (err.message.includes('NotFoundError')) {
          setError('No camera found on this device.');
        } else {
          setError(`Camera error: ${err.message}`);
        }
      } else {
        setError('Failed to start camera');
      }
    }
  };

  const stopScanning = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
    }
    setIsScanning(false);
  };

  const handleConnect = () => {
    if (scannedUrl) {
      onScan(scannedUrl);
    }
  };

  const handleRescan = () => {
    setScannedUrl(null);
    startScanning();
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5" />
            Scan QR Code
          </CardTitle>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose}
            data-testid="button-close-scanner"
          >
            <X className="w-5 h-5" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {scannedUrl ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-green-600 dark:text-green-400">QR Code Scanned!</p>
                  <p className="text-sm text-muted-foreground truncate">{scannedUrl}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={handleConnect} 
                  className="flex-1"
                  data-testid="button-connect-scanned"
                >
                  Connect Now
                </Button>
                <Button 
                  variant="outline" 
                  onClick={handleRescan}
                  data-testid="button-rescan"
                >
                  Rescan
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div 
                id="qr-reader" 
                ref={containerRef}
                className="w-full aspect-square bg-muted rounded-lg overflow-hidden"
                style={{ display: isScanning ? 'block' : 'none' }}
              />
              
              {!isScanning && !error && (
                <div className="flex flex-col items-center gap-4 py-8">
                  <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
                    <Camera className="w-12 h-12 text-primary" />
                  </div>
                  <p className="text-center text-muted-foreground">
                    Point your camera at the QR code displayed on the Desktop App
                  </p>
                  <Button 
                    onClick={startScanning}
                    size="lg"
                    data-testid="button-start-scan"
                  >
                    <Camera className="w-5 h-5 mr-2" />
                    Start Camera
                  </Button>
                </div>
              )}

              {isScanning && (
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-3">
                    Position the QR code within the frame
                  </p>
                  <Button 
                    variant="outline" 
                    onClick={stopScanning}
                    data-testid="button-stop-scan"
                  >
                    Cancel
                  </Button>
                </div>
              )}

              {error && (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-destructive">Camera Error</p>
                      <p className="text-sm text-muted-foreground">{error}</p>
                    </div>
                  </div>
                  <Button 
                    onClick={startScanning} 
                    className="w-full"
                    data-testid="button-retry-scan"
                  >
                    Try Again
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

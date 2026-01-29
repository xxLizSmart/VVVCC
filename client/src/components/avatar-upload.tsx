import { useState, useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, X, Upload, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AvatarUploadProps {
  userId: string;
  currentAvatarUrl: string | null;
  username: string;
  authToken: string;
  onAvatarUpdated: (newUrl: string) => void;
  onClose: () => void;
}

export function AvatarUpload({ userId, currentAvatarUrl, username, authToken, onAvatarUpdated, onClose }: AvatarUploadProps) {
  const [preview, setPreview] = useState<string | null>(currentAvatarUrl);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file",
        description: "Please select an image file",
        variant: "destructive"
      });
      return;
    }

    if (file.size > 500 * 1024) {
      toast({
        title: "File too large",
        description: "Please select an image under 500KB",
        variant: "destructive"
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 200;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
          const resized = canvas.toDataURL('image/jpeg', 0.8);
          setPreview(resized);
        }
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!preview) return;

    setIsUploading(true);
    try {
      const response = await fetch('/api/avatar/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, avatarData: preview, authToken })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      toast({
        title: "Avatar updated!",
        description: "Your new profile picture is now visible to everyone",
      });

      onAvatarUpdated(data.avatar_url);
      onClose();
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive"
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            Update Avatar
          </CardTitle>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose}
            data-testid="button-close-avatar"
          >
            <X className="w-5 h-5" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col items-center gap-4">
            <Avatar className="h-32 w-32 border-4 border-primary/20">
              <AvatarImage src={preview || undefined} alt={username} />
              <AvatarFallback className="text-3xl bg-primary/20">
                {username?.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
              data-testid="input-avatar-file"
            />

            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              data-testid="button-select-image"
            >
              <Camera className="w-4 h-4 mr-2" />
              Select Image
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Square images work best. Max 500KB.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleUpload}
              disabled={!preview || preview === currentAvatarUrl || isUploading}
              className="flex-1"
              data-testid="button-upload-avatar"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Save Avatar
                </>
              )}
            </Button>
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-avatar">
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

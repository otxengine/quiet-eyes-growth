import React, { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Upload, Loader2, Trash2, Video } from 'lucide-react';

const MAX_FILE_BYTES = 35 * 1024 * 1024; // raw ceiling matching the server's 50MB base64-JSON body limit

function assetSrc(asset) {
  if (asset.url) return asset.url;
  if (asset.image_base64) return `data:${asset.mime_type || 'image/jpeg'};base64,${asset.image_base64}`;
  return null;
}

/**
 * Per-business media library: upload images/video with a required description
 * (so post-generation prompts know what the media shows), browse, and delete.
 * Pass `onSelect` to render as a picker instead of a standalone library.
 */
export default function MediaLibrary({ businessProfileId, onSelect }) {
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [pending, setPending]     = useState(null); // { dataUrl, mimeType, mediaType }
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['mediaLibrary', businessProfileId],
    queryFn: () => base44.entities.MediaAsset.filter({ linked_business: businessProfileId }, '-created_date', 100),
    enabled: !!businessProfileId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.MediaAsset.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mediaLibrary', businessProfileId] });
      toast.success('נמחק');
    },
  });

  const handleFileChange = (file) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { toast.error('הקובץ גדול מדי (עד 35MB)'); return; }
    const mediaType = file.type.startsWith('video') ? 'video' : 'image';
    const reader = new FileReader();
    reader.onload = (e) => {
      setPending({ dataUrl: e.target.result, mimeType: file.type || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg'), mediaType });
      setDescription('');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!description.trim()) { toast.error('יש להוסיף תיאור'); return; }
    setUploading(true);
    try {
      const res = await base44.functions.invoke('uploadBusinessMedia', {
        businessProfileId,
        fileBase64: pending.dataUrl,
        mimeType:   pending.mimeType,
        mediaType:  pending.mediaType,
        description: description.trim(),
      });
      if (res?.error) throw new Error(res.error);
      toast.success('המדיה נשמרה בספרייה');
      setPending(null);
      setDescription('');
      queryClient.invalidateQueries({ queryKey: ['mediaLibrary', businessProfileId] });
    } catch (err) {
      toast.error('שגיאה בהעלאה: ' + (err?.message || 'נסה שוב'));
    }
    setUploading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-foreground">ספריית מדיה</h3>
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border border-dashed border-border text-foreground-muted hover:bg-secondary transition-colors">
          <Upload className="w-3.5 h-3.5" /> העלה מדיה
        </button>
        <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden"
          onChange={e => handleFileChange(e.target.files?.[0])} />
      </div>

      {pending && (
        <div className="p-3 border border-border rounded-xl bg-secondary/30 space-y-2">
          {pending.mediaType === 'video' ? (
            <video src={pending.dataUrl} className="w-full max-h-48 rounded-lg" controls />
          ) : (
            <img src={pending.dataUrl} alt="" className="w-full max-h-48 object-cover rounded-lg" />
          )}
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="מה רואים במדיה הזו? (חובה — כדי שה-AI ידע להשתמש בה בפוסטים)"
            rows={2}
            className="w-full text-[12px] bg-card border border-border rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex gap-2">
            <button onClick={() => { setPending(null); setDescription(''); }}
              className="flex-1 py-2 text-[12px] border border-border rounded-lg text-foreground-muted hover:text-foreground transition-colors">
              ביטול
            </button>
            <button onClick={handleSubmit} disabled={uploading}
              className="flex-1 py-2 text-[12px] font-medium bg-foreground text-background rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-60">
              {uploading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              שמור בספרייה
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-foreground-muted" /></div>
      ) : assets.length === 0 ? (
        <p className="text-[12px] text-foreground-muted text-center py-8">עדיין לא הועלתה מדיה</p>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
          {assets.map(asset => {
            const src = assetSrc(asset);
            return (
              <div key={asset.id} className="group">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => onSelect?.(asset)}
                    className={`w-full aspect-square rounded-lg overflow-hidden border border-border bg-secondary flex items-center justify-center ${onSelect ? 'cursor-pointer hover:ring-2 hover:ring-primary' : 'cursor-default'}`}
                  >
                    {asset.media_type === 'video' ? (
                      src ? <video src={src} className="w-full h-full object-cover" /> : <Video className="w-5 h-5 text-foreground-muted" />
                    ) : (
                      src ? <img src={src} alt="" className="w-full h-full object-cover" /> : null
                    )}
                  </button>
                  {!onSelect && (
                    <button
                      onClick={() => deleteMutation.mutate(asset.id)}
                      className="absolute top-1.5 left-1.5 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {asset.description && (
                  <p className="text-[10px] text-foreground-muted mt-1 line-clamp-2">{asset.description}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

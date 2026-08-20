import React, { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Upload, Loader2, Trash2, Video, Pencil } from 'lucide-react';

const MAX_FILE_BYTES = 35 * 1024 * 1024; // raw ceiling matching the server's 50MB base64-JSON body limit
const UPLOAD_CONCURRENCY = 3; // parallel LLM+upload calls per batch — keeps bulk uploads snappy without hammering the LLM
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3007/api').replace(/\/$/, '');

function assetSrc(asset) {
  // The S3 bucket is private, so S3-backed assets are served through our proxy
  // (which does an authenticated download) rather than the raw S3 URL.
  if (asset.url) return `${API_BASE}/social/media/${asset.id}`;
  if (asset.image_base64) return `data:${asset.mime_type || 'image/jpeg'};base64,${asset.image_base64}`;
  return null;
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Per-business media library: bulk-upload images/video (description is
 * AI-generated for images, no approval step — post-generation prompts need
 * the description, not a perfect one, and it stays editable after the fact),
 * browse, edit description inline, delete.
 * Pass `onSelect` to render as a picker instead of a standalone library.
 */
export default function MediaLibrary({ businessProfileId, onSelect }) {
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [progress, setProgress] = useState(null); // { done, total }
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

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

  const updateDescriptionMutation = useMutation({
    mutationFn: ({ id, description }) => base44.entities.MediaAsset.update(id, { description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mediaLibrary', businessProfileId] });
      setEditingId(null);
    },
  });

  async function uploadOneFile(file) {
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: קובץ גדול מדי (עד 35MB)`);
    const mediaType = file.type.startsWith('video') ? 'video' : 'image';
    const mimeType = file.type || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg');
    const dataUrl = await readAsDataURL(file);

    let description = '';
    if (mediaType === 'image') {
      try {
        const res = await base44.functions.invoke('describeBusinessMedia', { imageBase64: dataUrl, mimeType });
        description = ((res?.data || res)?.description || '').trim();
      } catch { /* fall through to placeholder below */ }
    }
    // No vision pipeline for video, and a failed AI call shouldn't block the upload —
    // fall back to a filename-based placeholder, editable afterward from the gallery.
    if (!description) description = file.name.replace(/\.[^.]+$/, '');

    const res = await base44.functions.invoke('uploadBusinessMedia', {
      businessProfileId, fileBase64: dataUrl, mimeType, mediaType, description,
    });
    if (res?.error) throw new Error(res.error);
  }

  const handleFilesChange = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    setProgress({ done: 0, total: files.length });
    let succeeded = 0;
    const failures = [];
    let next = 0;
    async function worker() {
      while (next < files.length) {
        const file = files[next++];
        try {
          await uploadOneFile(file);
          succeeded++;
        } catch (err) {
          failures.push(err?.message || file.name);
        }
        setProgress(p => ({ ...p, done: p.done + 1 }));
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker));

    setProgress(null);
    queryClient.invalidateQueries({ queryKey: ['mediaLibrary', businessProfileId] });
    if (succeeded) toast.success(`הועלו ${succeeded} קבצים בהצלחה${failures.length ? `, ${failures.length} נכשלו` : ''}`);
    else if (failures.length) toast.error('ההעלאה נכשלה: ' + failures[0]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-foreground">ספריית מדיה</h3>
        <button onClick={() => fileRef.current?.click()} disabled={!!progress}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border border-dashed border-border text-foreground-muted hover:bg-secondary transition-colors disabled:opacity-60">
          <Upload className="w-3.5 h-3.5" /> העלה מדיה
        </button>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden"
          onChange={e => { handleFilesChange(e.target.files); e.target.value = ''; }} />
      </div>

      {progress && (
        <div className="p-3 border border-border rounded-xl bg-secondary/30 flex items-center gap-2 text-[12px] text-foreground-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          מעלה ומתאר {progress.done}/{progress.total}...
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-foreground-muted" /></div>
      ) : assets.length === 0 && !progress ? (
        <p className="text-[12px] text-foreground-muted text-center py-8">עדיין לא הועלתה מדיה</p>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
          {assets.map(asset => {
            const src = assetSrc(asset);
            const isEditing = editingId === asset.id;
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
                {!onSelect && isEditing ? (
                  <div className="mt-1 space-y-1">
                    <textarea
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      rows={2}
                      autoFocus
                      className="w-full text-[10px] bg-card border border-border rounded-lg px-1.5 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex gap-1">
                      <button onClick={() => setEditingId(null)} className="flex-1 text-[9px] py-1 border border-border rounded text-foreground-muted">ביטול</button>
                      <button
                        onClick={() => updateDescriptionMutation.mutate({ id: asset.id, description: editValue.trim() })}
                        className="flex-1 text-[9px] py-1 bg-foreground text-background rounded"
                      >
                        שמור
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => !onSelect && (setEditingId(asset.id), setEditValue(asset.description || ''))}
                    className={`w-full text-right mt-1 flex items-start gap-1 ${onSelect ? '' : 'hover:bg-secondary rounded'}`}
                  >
                    <p className="text-[10px] text-foreground-muted line-clamp-2 flex-1">{asset.description || '—'}</p>
                    {!onSelect && <Pencil className="w-2.5 h-2.5 text-foreground-muted opacity-0 group-hover:opacity-100 flex-shrink-0 mt-0.5" />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

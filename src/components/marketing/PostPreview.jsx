import { Heart, MessageCircle, Send, Bookmark, ThumbsUp, Share2, MoreHorizontal, ImageOff, Globe } from 'lucide-react';
import { API_BASE } from '@/components/competitors/socialShared';

// Renders a not-yet-published post the way it will look in the platform's own
// feed, so the owner judges the post itself rather than a wall of caption text.
// ponytail: static look-alike (no live render from Meta), close enough to judge a post.

function handleFromUrl(url) {
  const m = (url || '').match(/instagram\.com\/([^/?#]+)/i);
  return m ? m[1] : null;
}

const textDir = (text) => (/[֐-׿]/.test(text || '') ? 'rtl' : 'ltr');

function Avatar({ src, name, size = 32 }) {
  const style = { width: size, height: size };
  return src ? (
    <img src={`${API_BASE}/competitors/proxy-image?url=${encodeURIComponent(src)}`} alt="" style={style}
      className="rounded-full object-cover shrink-0 border border-black/10" />
  ) : (
    <div style={style} className="rounded-full shrink-0 bg-gray-200 flex items-center justify-center text-[11px] font-bold text-gray-600">
      {(name || '?').slice(0, 1)}
    </div>
  );
}

// Hashtags render in link-blue like the real apps.
function Caption({ text }) {
  return (text || '').split(/(#[\p{L}\p{N}_]+)/u).map((part, i) =>
    part.startsWith('#') ? <span key={i} className="text-[#00376b]">{part}</span> : part
  );
}

function Media({ url, aspect }) {
  if (url) return <img src={url} alt="" className={`w-full ${aspect} object-cover bg-gray-100`} />;
  return (
    <div className={`w-full ${aspect} bg-gray-50 border-y border-dashed border-gray-300 flex flex-col items-center justify-center gap-1.5 text-gray-400`}>
      <ImageOff className="w-6 h-6" />
      <span className="text-[11px]">אין תמונה עדיין</span>
    </div>
  );
}

export default function PostPreview({ post, businessProfile, profilePicture, full = false }) {
  const name = businessProfile?.name || '';
  const clamp = full ? 'whitespace-pre-wrap' : 'line-clamp-2';

  if (post.post_type === 'story') {
    return (
      <div className="relative w-full aspect-[9/16] max-h-[520px] mx-auto rounded-xl overflow-hidden bg-gray-900" dir="ltr">
        {post.image_url && <img src={post.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
        <div className="absolute top-0 inset-x-0 p-3 bg-gradient-to-b from-black/50 to-transparent">
          <div className="h-0.5 bg-white/40 rounded mb-2"><div className="h-full w-1/3 bg-white rounded" /></div>
          <div className="flex items-center gap-2 text-white text-[12px] font-semibold">
            <Avatar src={profilePicture} name={name} size={24} />
            {handleFromUrl(businessProfile?.instagram_url) || name}
          </div>
        </div>
        {!post.image_url && (
          <p dir="auto" className={`absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-white text-[14px] leading-relaxed ${full ? '' : 'line-clamp-6'}`}>
            {post.content}
          </p>
        )}
      </div>
    );
  }

  if (post.platform === 'instagram') {
    const handle = handleFromUrl(businessProfile?.instagram_url) || name;
    return (
      <div className="bg-white text-[#0f1419] text-[13px]" dir="ltr">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <Avatar src={profilePicture} name={name} />
          <span className="font-semibold text-[13px]">{handle}</span>
          <MoreHorizontal className="w-5 h-5 ml-auto" />
        </div>
        <Media url={post.image_url} aspect="aspect-square" />
        <div className="flex items-center gap-4 px-3 pt-2.5 pb-1.5">
          <Heart className="w-6 h-6" /><MessageCircle className="w-6 h-6 -scale-x-100" /><Send className="w-6 h-6" />
          <Bookmark className="w-6 h-6 ml-auto" />
        </div>
        {/* dir from the caption, not dir="auto" — that would lock onto the Latin handle.
            Padding lives on the wrapper: line-clamp leaks the next line into its own padding. */}
        <div className="px-3 pb-3">
          <p dir={textDir(post.content)} className={`leading-snug ${clamp}`}>
            <span className="font-semibold">{handle}</span>{' '}<Caption text={post.content} />
          </p>
        </div>
      </div>
    );
  }

  // Facebook (and Google Business, which has the same text-over-image layout).
  return (
    <div className="bg-white text-[#050505] text-[14px]" dir="rtl">
      <div className="flex items-center gap-2.5 px-3 pt-3 pb-2">
        <Avatar src={profilePicture} name={name} size={40} />
        <div className="leading-tight">
          <p className="font-semibold text-[14px]">{name}</p>
          <p className="text-[12px] text-[#65676b] flex items-center gap-1">עכשיו · <Globe className="w-3 h-3" /></p>
        </div>
        <MoreHorizontal className="w-5 h-5 mr-auto text-[#65676b]" />
      </div>
      <div className="px-3 pb-3">
        <p dir={textDir(post.content)} className={`leading-snug ${full ? 'whitespace-pre-wrap' : 'line-clamp-3'}`}>
          <Caption text={post.content} />
        </p>
      </div>
      <Media url={post.image_url} aspect="aspect-[1.91/1]" />
      <div className="flex justify-around py-1.5 mx-3 border-t border-[#ced0d4] text-[13px] font-semibold text-[#65676b]">
        <span className="flex items-center gap-1.5"><ThumbsUp className="w-4 h-4" /> לייק</span>
        <span className="flex items-center gap-1.5"><MessageCircle className="w-4 h-4" /> תגובה</span>
        <span className="flex items-center gap-1.5"><Share2 className="w-4 h-4" /> שיתוף</span>
      </div>
    </div>
  );
}

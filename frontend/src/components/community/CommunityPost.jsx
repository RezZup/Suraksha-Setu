import React, { useState } from 'react';
import { 
  ThumbsUp, MessageSquare, Share2, Bookmark, MapPin, 
  MoreVertical, Trash2, Edit2, Flag, ExternalLink,
  Play, Volume2, VolumeX, Maximize2, Heart, Image as ImageIcon,
  MessageCircle, ShieldAlert, CheckCircle2, RotateCcw, Hash
} from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import CommentSection from './CommentSection';
import DirectMessagePanel from './DirectMessagePanel';
import { cn } from "@/lib/utils";
import { toast } from 'sonner';
import { getAuthHeadersForApi } from '@/utils/authHeaders';

const BADGE_STYLE = {
  Guardian:  'bg-purple-100 text-purple-700 border-purple-200',
  Saviour:   'bg-indigo-100 text-indigo-700 border-indigo-200',
  Hero:      'bg-blue-100 text-blue-700 border-blue-200',
  Responder: 'bg-green-100 text-green-700 border-green-200',
  Helper:    'bg-teal-100 text-teal-700 border-teal-200',
};

const AUTHENTICITY_STYLE = {
  likely_real: 'bg-emerald-600',
  uncertain: 'bg-amber-600',
  suspected_fake: 'bg-rose-700',
};

const AUTHENTICITY_LABEL = {
  likely_real: 'Likely real',
  uncertain: 'Unverified',
  suspected_fake: 'Possible fake',
};

const VERIFICATION_STYLE = {
  pending_admin_review: {
    badge: 'bg-amber-100 text-amber-700 border-amber-300',
    bar: 'bg-amber-500',
  },
  in_review: {
    badge: 'bg-blue-100 text-blue-700 border-blue-300',
    bar: 'bg-blue-500',
  },
  needs_info: {
    badge: 'bg-orange-100 text-orange-700 border-orange-300',
    bar: 'bg-orange-500',
  },
  approved: {
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-300',
    bar: 'bg-emerald-600',
  },
  rejected: {
    badge: 'bg-rose-100 text-rose-700 border-rose-300',
    bar: 'bg-rose-600',
  },
};

const VERIFICATION_LABEL = {
  pending_admin_review: 'Pending Admin Review',
  in_review: 'Under Review',
  needs_info: 'Need More Information',
  approved: 'Verified by Admin',
  rejected: 'Rejected',
  not_required: 'No Verification Needed',
};

const CommunityPost = ({ 
  post, 
  onLike, 
  onDelete, 
  onShare, 
  onSave,
  currentUserId,
  currentUserName,
  currentUserPhoto,
  authorBadge,
}) => {
  const [showComments, setShowComments] = useState(false);
  const [showDM, setShowDM] = useState(false);
  const [liked, setLiked] = useState(post.likedByUser || false);
  const [likeCount, setLikeCount] = useState(post.likes || 0);
  const [saved, setSaved] = useState(post.savedByUser || false);
  const [comments, setComments] = useState(post.comments || []);
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const [isResolved, setIsResolved] = useState(post.is_resolved || false);
  const [resolving, setResolving] = useState(false);
  // Report dialog
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);
  const getAuthHeaders = () => getAuthHeadersForApi(process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000', 'citizen');
  const backendBase = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

  const toAbsoluteUrl = (url) => {
    if (!url || typeof url !== 'string') return '';
    if (/^https?:\/\//i.test(url)) return url;
    return `${backendBase}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const resolveMediaUrls = (media) => {
    const local = toAbsoluteUrl(media?.local_url || media?.backup_url);
    const primary = toAbsoluteUrl(media?.url);
    const cdn = toAbsoluteUrl(media?.cdn_url);

    if (local) {
      return {
        src: local,
        fallback: primary && primary !== local ? primary : (cdn && cdn !== local ? cdn : ''),
      };
    }
    if (primary) {
      return {
        src: primary,
        fallback: cdn && cdn !== primary ? cdn : '',
      };
    }
    return { src: media?.preview || '', fallback: '' };
  };

  // Sync like count from parent when the post prop updates (e.g. after re-fetch)
  React.useEffect(() => {
    setLikeCount(post.likes || 0);
    setIsResolved(post.is_resolved || false);
  }, [post.likes, post.is_resolved]);

  // Sync comments from parent when the underlying post changes (navigation / re-fetch)
  React.useEffect(() => {
    setComments(post.comments || []);
  }, [post.id]);

  const isOwnPost =
    (currentUserId && post.user_id && post.user_id === currentUserId) ||
    (currentUserName && post.author && post.author === currentUserName);

  const handleLike = () => {
    setLiked(!liked);
    setLikeCount(liked ? likeCount - 1 : likeCount + 1);
    onLike?.(post.id, !liked);
  };

  const handleSave = () => {
    setSaved(!saved);
    onSave?.(post.id, !saved);
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: post.title || 'Community Post',
        text: post.content,
        url: window.location.href
      });
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(window.location.href);
      alert('Link copied to clipboard!');
    }
    onShare?.(post.id);
  };

  const handleResolve = async () => {
    const newResolved = !isResolved;
    setIsResolved(newResolved);
    setResolving(true);
    try {
      const API_URL = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000') + '/api';
      const res = await fetch(`${API_URL}/community/posts/${post.id}/resolve?resolved=${newResolved}&user_id=${encodeURIComponent(currentUserId || '')}`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        setIsResolved(!newResolved);
        toast.error('Could not update status. Please try again.');
      } else if (newResolved) {
        toast.success('🎉 Marked as resolved! Thank you for updating the community.');
      } else {
        toast.info('Post re-opened — others can still help.');
      }
    } catch (e) {
      setIsResolved(!newResolved);
      toast.error('Network error. Please try again.');
    } finally {
      setResolving(false);
    }
  };

  const handleSubmitReport = async () => {
    if (!reportReason) { toast.error('Please select a reason'); return; }
    if (!currentUserId) { toast.error('You must be logged in to report'); return; }
    setSubmittingReport(true);
    try {
      const API_URL = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000') + '/api';
      const res = await fetch(`${API_URL}/community/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          reporter_id: currentUserId,
          reporter_name: currentUserName || 'Community Member',
          reported_user_id: post.user_id || 'anonymous',
          reported_user_name: post.author || 'Anonymous',
          post_id: post.id,
          reason: reportReason,
          description: reportDescription.trim() || null,
        }),
      });
      if (res.ok) {
        toast.success('Report submitted. Thank you for keeping the community safe.');
        setShowReportDialog(false);
        setReportReason('');
        setReportDescription('');
      } else {
        toast.error('Failed to submit report. Please try again.');
      }
    } catch (e) {
      toast.error('Network error. Please try again.');
    } finally {
      setSubmittingReport(false);
    }
  };

  const getPostTypeColor = () => {
    switch (post.type) {
      case 'emergency': return 'bg-red-600 text-white';
      case 'help': return 'bg-red-500 text-white';
      case 'offer': return 'bg-green-500 text-white';
      case 'alert': return 'bg-orange-500 text-white';
      default: return 'bg-blue-500 text-white';
    }
  };

  const getPostTypeLabel = () => {
    switch (post.type) {
      case 'emergency': return 'Emergency';
      case 'help': return 'Help Needed';
      case 'offer': return 'Offering Help';
      case 'alert': return 'Alert';
      default: return 'General';
    }
  };

  const timeAgo = getTimeAgo(post.timestamp);
  const mediaFiles = post.media || [];
  const hasMedia = mediaFiles.length > 0;
  const fallbackImageAnalysis = mediaFiles
    .map((m) => m?.analysis?.analysis)
    .filter(Boolean)
    .sort((a, b) => (b?.confidence || 0) - (a?.confidence || 0))[0] || null;
  const postImageAnalysis = post.image_analysis || fallbackImageAnalysis;
  const postGeneratedDescription = postImageAnalysis
    ? (postImageAnalysis.self_generated_description || postImageAnalysis.description || '')
    : '';
  const verification = post.verification || {};
  const requiresAdminReview = Boolean(
    verification.requires_admin_review ?? post.verification_requires_admin_review
  );
  const verificationStatus = String(
    verification.status || post.verification_status || ''
  ).toLowerCase();
  const verificationProgress = Math.max(
    0,
    Math.min(
      100,
      Number(verification.progress_percent ?? post.verification_progress ?? 0) || 0
    )
  );
  const verificationLabel = verification.status_label || VERIFICATION_LABEL[verificationStatus] || 'Verification';
  const verificationStyle = VERIFICATION_STYLE[verificationStatus] || {
    badge: 'bg-slate-100 text-slate-700 border-slate-300',
    bar: 'bg-slate-500',
  };
  const verificationMessage = verification.message || '';
  const adminComment = post.admin_comment || verification.admin_comment;
  const adminReport = post.admin_report || verification.report_to_user;
  const showGeneratedDescription = (
    postGeneratedDescription
    && postGeneratedDescription.trim().toLowerCase() !== (post.content || '').trim().toLowerCase()
  );

  const typeBorderColor = {
    emergency: 'border-l-4 border-l-red-600',
    help:      'border-l-4 border-l-orange-500',
    offer:     'border-l-4 border-l-green-500',
    alert:     'border-l-4 border-l-yellow-500',
    general:   'border-l-4 border-l-blue-400',
  }[post.type] || 'border-l-4 border-l-blue-400';

  const cardBorderClass = isResolved ? 'border-l-4 border-l-green-500' : typeBorderColor;

  return (
    <>
      <Card className={cn('mb-3 overflow-hidden shadow-sm hover:shadow-md transition-shadow', cardBorderClass, isResolved && 'opacity-80 bg-green-50/30 dark:bg-green-950/10')}>
        <CardContent className="p-0">
          {/* Resolved Banner */}
          {isResolved && (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-100 dark:bg-green-900/30 border-b border-green-200 dark:border-green-800">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
              <span className="text-xs font-semibold text-green-700 dark:text-green-400">
                {post.type === 'help' ? 'Help received — resolved' :
                 post.type === 'offer' ? 'Offer fulfilled — resolved' :
                 post.type === 'emergency' ? 'Situation resolved' : 'Resolved'}
              </span>
              {post.resolved_at && (
                <span className="text-xs text-green-600/70 dark:text-green-500/70 ml-auto">
                  {new Date(post.resolved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>
          )}
          {/* Post Header */}
          <div className="p-4 pb-3">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3 flex-1">
                <Avatar>
                  <AvatarImage src={post.author_photo || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.author}`} />
                  <AvatarFallback>{post.author?.[0] || '?'}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-sm">{post.author}</h4>
                    {authorBadge && authorBadge.name !== 'Newcomer' && (
                      <span className={cn(
                        "text-[10px] font-semibold px-1.5 py-0.5 rounded-full border",
                        BADGE_STYLE[authorBadge.name] || 'bg-gray-100 text-gray-600 border-gray-200'
                      )}>
                        {authorBadge.emoji} {authorBadge.name}
                      </span>
                    )}
                    <Badge className={cn("text-xs", getPostTypeColor())}>
                      {getPostTypeLabel()}
                    </Badge>
                    {isResolved && (
                      <Badge className="text-xs bg-green-100 text-green-700 border border-green-300">
                        ✓ Resolved
                      </Badge>
                    )}
                    {requiresAdminReview && verificationStatus === 'approved' && (
                      <Badge className="text-xs bg-emerald-100 text-emerald-700 border border-emerald-300">
                        ✓ Admin Verified
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{timeAgo}</span>
                    {post.location && (
                      <>
                        <span>•</span>
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {post.location}
                        </div>
                      </>
                    )}
                    {post.pincode && (
                      <>
                        <span>•</span>
                        <div className="flex items-center gap-1">
                          <Hash className="w-3 h-3" />
                          {post.pincode}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Post Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isOwnPost ? (
                    <>
                      <DropdownMenuItem>
                        <Edit2 className="w-4 h-4 mr-2" />
                        Edit Post
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => onDelete?.(post.id)}
                        className="text-red-600"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete Post
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={handleSave}>
                        <Bookmark className="w-4 h-4 mr-2" />
                        {saved ? 'Unsave' : 'Save Post'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowReportDialog(true)} className="text-red-600">
                        <ShieldAlert className="w-4 h-4 mr-2" />
                        Report User / Post
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem onClick={handleShare}>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Share Externally
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Post Content */}
          <div className="px-4 pb-3">
            {post.title && (
              <h3 className="font-semibold text-base mb-2">{post.title}</h3>
            )}
            <p className="text-sm whitespace-pre-wrap">{post.content}</p>

            {requiresAdminReview && (
              <div className="mt-3 p-3 rounded-lg border bg-slate-50/80 dark:bg-slate-900/20">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Admin Verification Progress</p>
                  <Badge className={cn('text-[10px] border', verificationStyle.badge)}>
                    {verificationLabel}
                  </Badge>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    className={cn('h-full transition-all', verificationStyle.bar)}
                    style={{ width: `${verificationProgress}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {verificationMessage || 'Your post has entered the admin verification queue.'}
                </p>
                {adminComment && (
                  <p className="mt-2 text-xs text-blue-700 dark:text-blue-300">
                    Admin comment: {adminComment}
                  </p>
                )}
                {adminReport && (
                  <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                    Admin report: {adminReport}
                  </p>
                )}
                {!post.is_public && (
                  <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                    This post is visible to you and admins until verification is approved.
                  </p>
                )}
              </div>
            )}

            {/* AI Image Analysis Badge */}
            {postImageAnalysis && (
              <div className="mt-2 flex items-center gap-2 p-2 rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                <span className="text-base">
                  {{'fire':'🔥','flood':'🌊','earthquake':'🌍','cyclone':'🌀','landslide':'🏔️','none':'📷'}[postImageAnalysis.disaster_type] || '⚠️'}
                </span>
                <div>
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400 capitalize">
                    {postImageAnalysis.disaster_type !== 'none'
                      ? `${postImageAnalysis.disaster_type} detected in image · ${postImageAnalysis.severity} severity`
                      : 'Image analyzed by AI'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {Math.round((postImageAnalysis.confidence || 0) * 100)}% confidence · {AUTHENTICITY_LABEL[postImageAnalysis.authenticity] || 'Unverified'}
                  </p>
                  {showGeneratedDescription && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      AI summary: {postGeneratedDescription}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Tags */}
            {post.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {post.tags.map((tag, index) => (
                  <Badge key={index} variant="outline" className="text-xs">
                    #{tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Media Gallery */}
          {hasMedia && (
            <div className={cn(
              "grid gap-1 px-4 pb-3",
              mediaFiles.length === 1 && "grid-cols-1",
              mediaFiles.length === 2 && "grid-cols-2",
              mediaFiles.length >= 3 && "grid-cols-2"
            )}>
              {mediaFiles.slice(0, 4).map((media, index) => {
                const mediaUrls = resolveMediaUrls(media);
                const mediaSrc = mediaUrls.src;
                const mediaType = media.type || 'image/jpeg';
                const mediaAnalysis = media.analysis?.analysis;
                return (
                <div
                  key={media.id || media.url || index}
                  className={cn(
                    "relative rounded-lg overflow-hidden bg-muted cursor-pointer",
                    mediaFiles.length === 1 && "h-96",
                    mediaFiles.length >= 2 && "h-48",
                    index === 3 && mediaFiles.length > 4 && "relative"
                  )}
                  onClick={() => {
                    setSelectedMediaIndex(index);
                    setShowMediaModal(true);
                  }}
                >
                  {/* Image */}
                  {mediaType.startsWith('image/') && (
                    <>
                      <img
                        src={mediaSrc}
                        alt={media.name || 'photo'}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          if (mediaUrls.fallback && e.currentTarget.src !== mediaUrls.fallback) {
                            e.currentTarget.src = mediaUrls.fallback;
                          }
                        }}
                      />
                      {media.geotag && (
                        <Badge 
                          variant="secondary" 
                          className="absolute top-2 left-2 text-xs gap-1"
                        >
                          <MapPin className="w-3 h-3" />
                          GPS
                        </Badge>
                      )}
                      {/* AI analysis badge */}
                      {mediaAnalysis && mediaAnalysis.disaster_type !== 'none' && (
                        <Badge
                          className="absolute bottom-2 left-2 text-xs text-white border-0"
                          style={{ backgroundColor: { low: '#eab308', medium: '#f97316', high: '#ef4444', critical: '#991b1b' }[mediaAnalysis.severity] || '#6b7280' }}
                        >
                          {mediaAnalysis.disaster_type} · {mediaAnalysis.severity}
                        </Badge>
                      )}
                      {mediaAnalysis?.authenticity && (
                        <Badge
                          className={cn(
                            'absolute top-2 right-2 text-xs text-white border-0',
                            AUTHENTICITY_STYLE[mediaAnalysis.authenticity] || 'bg-gray-600'
                          )}
                        >
                          {AUTHENTICITY_LABEL[mediaAnalysis.authenticity] || 'Unverified'}
                        </Badge>
                      )}
                    </>
                  )}

                  {/* Video */}
                  {mediaType.startsWith('video/') && (
                    <>
                      <video
                        src={mediaSrc}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <Play className="w-12 h-12 text-white" />
                      </div>
                      {media.geotag && (
                        <Badge 
                          variant="secondary" 
                          className="absolute top-2 left-2 text-xs gap-1"
                        >
                          <MapPin className="w-3 h-3" />
                          GPS
                        </Badge>
                      )}
                    </>
                  )}

                  {/* Audio */}
                  {mediaType.startsWith('audio/') && (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500">
                      <Volume2 className="w-12 h-12 text-white" />
                    </div>
                  )}

                  {/* Other files */}
                  {!mediaType.startsWith('image/') && 
                   !mediaType.startsWith('video/') && 
                   !mediaType.startsWith('audio/') && (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-muted">
                      <ImageIcon className="w-8 h-8 text-muted-foreground mb-2" />
                      <p className="text-xs text-muted-foreground text-center px-2 truncate w-full">
                        {media.name}
                      </p>
                    </div>
                  )}

                  {/* More media indicator */}
                  {index === 3 && mediaFiles.length > 4 && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <span className="text-white text-2xl font-bold">
                        +{mediaFiles.length - 4}
                      </span>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}

          {/* Post Stats — always visible */}
          <div className="px-4 py-2 border-t flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <button
                onClick={handleLike}
                className={cn(
                  'flex items-center gap-1 transition-colors hover:text-red-500',
                  liked && 'text-red-500 font-semibold'
                )}
              >
                <Heart className={cn('w-3.5 h-3.5', liked && 'fill-current')} />
                <span>{likeCount}</span>
                <span className="hidden sm:inline">{likeCount === 1 ? 'like' : 'likes'}</span>
              </button>
              <button
                onClick={() => setShowComments(!showComments)}
                className="flex items-center gap-1 transition-colors hover:text-primary"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>{post.comments_count != null ? post.comments_count : comments.length}</span>
                <span className="hidden sm:inline">{(post.comments_count != null ? post.comments_count : comments.length) === 1 ? 'comment' : 'comments'}</span>
              </button>
            </div>
            {saved && (
              <span className="text-xs text-blue-500 flex items-center gap-1">
                <Bookmark className="w-3 h-3 fill-current" /> Saved
              </span>
            )}
          </div>

          {/* Post Actions */}
          <div className="px-2 py-1 border-t flex items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLike}
              className={cn(
                'gap-1.5 flex-1 text-xs h-9',
                liked && 'text-red-500 hover:text-red-600'
              )}
            >
              <Heart className={cn('w-3.5 h-3.5', liked && 'fill-current')} />
              <span>{liked ? 'Liked' : 'Like'}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowComments(!showComments)}
              className={cn('gap-1.5 flex-1 text-xs h-9', showComments && 'text-primary')}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Comment</span>
            </Button>

            {!isOwnPost && (post.type === 'help' || post.type === 'offer' || post.type === 'emergency' || post.type === 'alert') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDM(true)}
                className="gap-1.5 flex-1 text-xs h-9 text-blue-600 hover:text-blue-700"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>Message</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={handleShare}
              className="gap-1.5 flex-1 text-xs h-9"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Share</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleSave}
              className={cn('gap-1.5 flex-1 text-xs h-9', saved && 'text-blue-500')}
            >
              <Bookmark className={cn('w-3.5 h-3.5', saved && 'fill-current')} />
              <span>{saved ? 'Saved' : 'Save'}</span>
            </Button>

            {/* Resolve button — only for post owner on help/offer/emergency posts */}
            {isOwnPost && (post.type === 'help' || post.type === 'offer' || post.type === 'emergency') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResolve}
                disabled={resolving}
                title={isResolved ? 'Mark this post as active again' : 'Mark this post as resolved'}
                className={cn(
                  'gap-1.5 flex-1 text-xs h-9',
                  isResolved
                    ? 'text-green-700 bg-green-100/70 hover:bg-green-100 hover:text-green-800'
                    : 'text-gray-500 hover:text-green-600'
                )}
              >
                {isResolved ? (
                  <RotateCcw className="w-3.5 h-3.5" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span>{isResolved ? 'Re-open' : 'Mark Resolved'}</span>
              </Button>
            )}
          </div>

          {/* Comments Section */}
          {showComments && (
            <div className="px-4 py-4 border-t bg-muted/50">
              <CommentSection
                postId={post.id}
                comments={comments}
                onCommentsChange={setComments}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                currentUserPhoto={currentUserPhoto}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Direct Message Panel */}
      {showDM && (
        <DirectMessagePanel
          isOpen={showDM}
          onClose={() => setShowDM(false)}
          myUserId={currentUserId}
          myName={currentUserName}
          myPhoto={currentUserPhoto}
          initialPartner={{ id: post.user_id, name: post.author, photo: post.author_photo }}
          initialPostId={post.id}
          initialPostSnippet={post.content ? post.content.slice(0, 60) : null}
        />
      )}

      {/* Report User Dialog */}
      <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <ShieldAlert className="w-5 h-5" />
              Report User / Post
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              You are reporting <strong>{post.author}</strong>'s post. Our team will review and take action within 24 hours.
            </p>
            <div className="space-y-1.5">
              <Label>Reason <span className="text-red-500">*</span></Label>
              <Select value={reportReason} onValueChange={setReportReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="misinformation">🚫 Misinformation / Fake News</SelectItem>
                  <SelectItem value="false_emergency">🔴 False Emergency Alert</SelectItem>
                  <SelectItem value="spam">📢 Spam</SelectItem>
                  <SelectItem value="harassment">⚠️ Harassment / Bullying</SelectItem>
                  <SelectItem value="inappropriate">🔞 Inappropriate Content</SelectItem>
                  <SelectItem value="other">📝 Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Additional Details (Optional)</Label>
              <Textarea
                placeholder="Describe why this post is problematic..."
                value={reportDescription}
                onChange={(e) => setReportDescription(e.target.value)}
                className="min-h-[80px]"
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground text-right">{reportDescription.length}/500</p>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => { setShowReportDialog(false); setReportReason(''); setReportDescription(''); }}>
              Cancel
            </Button>
            <Button variant="destructive" className="flex-1" onClick={handleSubmitReport} disabled={!reportReason || submittingReport}>
              {submittingReport ? 'Submitting...' : 'Submit Report'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Media Modal */}
      <Dialog open={showMediaModal} onOpenChange={setShowMediaModal}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Media Viewer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {mediaFiles[selectedMediaIndex] && (() => {
              const sel = mediaFiles[selectedMediaIndex];
              const selType = sel.type || 'image/jpeg';
              const selUrls = resolveMediaUrls(sel);
              const selSrc = selUrls.src;
              return (
              <>
                {/* Current Media */}
                <div className="relative rounded-lg overflow-hidden bg-black">
                  {selType.startsWith('image/') && (
                    <img
                      src={selSrc}
                      alt={sel.name}
                      className="w-full max-h-[70vh] object-contain"
                      onError={(e) => {
                        if (selUrls.fallback && e.currentTarget.src !== selUrls.fallback) {
                          e.currentTarget.src = selUrls.fallback;
                        }
                      }}
                    />
                  )}
                  {selType.startsWith('video/') && (
                    <video
                      src={selSrc}
                      controls
                      className="w-full max-h-[70vh]"
                    />
                  )}
                  {selType.startsWith('audio/') && (
                    <div className="p-12 flex items-center justify-center">
                      <audio
                        src={selSrc}
                        controls
                        className="w-full"
                      />
                    </div>
                  )}

                  {/* Geotag info */}
                  {sel.geotag && sel.geotag.latitude && (
                    <div className="absolute bottom-4 left-4 bg-black/70 text-white p-3 rounded-lg text-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <MapPin className="w-4 h-4" />
                        <span className="font-semibold">Location Data</span>
                      </div>
                      <p className="text-xs">
                        Lat: {sel.geotag.latitude.toFixed(6)}
                      </p>
                      <p className="text-xs">
                        Lng: {sel.geotag.longitude.toFixed(6)}
                      </p>
                      {sel.geotag.accuracy && (
                        <p className="text-xs">
                          Accuracy: ±{sel.geotag.accuracy.toFixed(0)}m
                        </p>
                      )}
                    </div>
                  )}

                  {/* AI Analysis overlay */}
                  {sel.analysis?.analysis && (
                    <div className="absolute top-4 right-4 bg-black/70 text-white p-3 rounded-lg text-sm">
                      <p className="font-semibold capitalize">
                        {sel.analysis.analysis.disaster_type !== 'none'
                          ? `${sel.analysis.analysis.disaster_type} detected`
                          : 'Image analyzed'}
                      </p>
                      {sel.analysis.analysis.disaster_type !== 'none' && (
                        <p className="text-xs">Severity: {sel.analysis.analysis.severity}</p>
                      )}
                      <p className="text-xs">Confidence: {Math.round(sel.analysis.analysis.confidence * 100)}%</p>
                      <p className="text-xs">Authenticity: {AUTHENTICITY_LABEL[sel.analysis.analysis.authenticity] || 'Unverified'}</p>
                      {(sel.analysis.analysis.self_generated_description || sel.analysis.analysis.description) && (
                        <p className="text-xs mt-1 max-w-[240px]">
                          {(sel.analysis.analysis.self_generated_description || sel.analysis.analysis.description).slice(0, 160)}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Thumbnails */}
                {mediaFiles.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {mediaFiles.map((media, index) => {
                      const thumbType = media.type || 'image/jpeg';
                      const thumbUrls = resolveMediaUrls(media);
                      const thumbSrc = thumbUrls.src;
                      return (
                      <button
                        key={media.id || media.url || index}
                        onClick={() => setSelectedMediaIndex(index)}
                        className={cn(
                          "flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all",
                          index === selectedMediaIndex 
                            ? "border-primary scale-105" 
                            : "border-transparent opacity-60 hover:opacity-100"
                        )}
                      >
                        {thumbType.startsWith('image/') && (
                          <img
                            src={thumbSrc}
                            alt={media.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              if (thumbUrls.fallback && e.currentTarget.src !== thumbUrls.fallback) {
                                e.currentTarget.src = thumbUrls.fallback;
                              }
                            }}
                          />
                        )}
                        {thumbType.startsWith('video/') && (
                          <div className="w-full h-full bg-black flex items-center justify-center">
                            <Play className="w-6 h-6 text-white" />
                          </div>
                        )}
                        {thumbType.startsWith('audio/') && (
                          <div className="w-full h-full bg-purple-500 flex items-center justify-center">
                            <Volume2 className="w-6 h-6 text-white" />
                          </div>
                        )}
                      </button>
                      );
                    })}
                  </div>
                )}
              </>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

// Helper function
function getTimeAgo(timestamp) {
  const now = new Date();
  const past = new Date(timestamp);
  const diffInSeconds = Math.floor((now - past) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
  return past.toLocaleDateString();
}

export default CommunityPost;

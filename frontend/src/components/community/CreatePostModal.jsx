import React, { useEffect, useState } from 'react';
import { 
  X, MapPin, Tag, AlertCircle, HelpCircle, 
  Megaphone, MessageSquare, Send, Camera, Trash2, Loader2
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import CameraCapture from './CameraCapture';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';

const reverseGeocode = async (lat, lon) => {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    const parts = [
      a.road || a.neighbourhood || '',
      a.city || a.town || a.village || a.county || '',
      a.state || '',
    ].filter(Boolean);
    return parts.join(', ') || data.display_name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
};

const API_URL = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000');

const SEVERITY_COLOR = { low: 'bg-yellow-500', medium: 'bg-orange-500', high: 'bg-red-500', critical: 'bg-red-700' };
const DISASTER_EMOJI = { fire: '🔥', flood: '🌊', earthquake: '🌍', cyclone: '🌀', landslide: '🏔️', none: '📷' };
const AUTHENTICITY_COLOR = { likely_real: 'bg-emerald-600', uncertain: 'bg-amber-600', suspected_fake: 'bg-rose-700' };
const AUTHENTICITY_LABEL = { likely_real: 'Likely Real', uncertain: 'Unverified', suspected_fake: 'Possible Fake' };

const getGeneratedDescription = (analysis) => (
  analysis?.self_generated_description || analysis?.description || ''
);

const isLikelyFake = (analysis) => {
  const authenticity = analysis?.authenticity;
  const syntheticProbability = Number(analysis?.synthetic_probability || 0);
  return authenticity === 'suspected_fake' && syntheticProbability >= 0.65;
};

// Determine if all uploaded images are irrelevant for non-general posts
const allImagesIrrelevant = (files, type) => {
  if (type === 'general') return false;
  const analyzed = files.filter((f) => f.analysis?.analysis);
  if (analyzed.length === 0) return false; // no analysis yet
  return analyzed.every((f) => f.analysis.analysis.disaster_type === 'none');
};

const getImageBlockReason = (files, type) => {
  const analyses = files.map((f) => f.analysis?.analysis).filter(Boolean);
  if (analyses.length === 0) return null;

  const highTrustTypes = new Set(['help', 'alert', 'emergency']);
  if (highTrustTypes.has(type) && analyses.some((a) => isLikelyFake(a))) {
    return 'AI authenticity check flagged this image as possibly edited/fake. Please upload an original photo.';
  }

  if (allImagesIrrelevant(files, type)) {
    return 'The image does not appear to show any disaster or emergency situation. Please capture a relevant photo or switch to General Post.';
  }
  return null;
};

// Auto-suggest disaster post type from AI analysis
const suggestPostType = (analysis) => {
  const dt = analysis?.disaster_type;
  if (!dt || dt === 'none') return null;
  const confidence = Number(analysis?.confidence || 0);
  const authenticity = analysis?.authenticity || 'uncertain';
  // Do not auto-escalate post type on weak/uncertain image analysis.
  if (authenticity !== 'likely_real' || confidence < 0.9) return null;
  const severity = analysis?.severity;
  if (severity === 'critical') return 'emergency';
  if (dt === 'fire' || dt === 'earthquake' || dt === 'cyclone') return 'alert';
  return 'alert';
};

// Build tags from AI analysis
const buildTagsFromAnalysis = (analysis) => {
  const t = [];
  if (analysis?.disaster_type && analysis.disaster_type !== 'none') t.push(analysis.disaster_type);
  (analysis?.objects_detected || []).slice(0, 3).forEach((o) => {
    const clean = o.toLowerCase().replace(/\s+/g, '_');
    if (clean && !t.includes(clean)) t.push(clean);
  });
  return t;
};

const CreatePostModal = ({ isOpen, onClose, onPostCreated }) => {
  const { user, userLocation } = useAuth();
  const [postType, setPostType] = useState('general');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  // Pre-fill from cached user location (city-level, not precise)
  const [location, setLocation] = useState(() => userLocation?.display || '');
  const [autoLocation, setAutoLocation] = useState(() =>
    userLocation ? { latitude: userLocation.lat, longitude: userLocation.lon } : null
  );
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [imageBlockReason, setImageBlockReason] = useState(null);

  useEffect(() => {
    setImageBlockReason(getImageBlockReason(uploadedFiles, postType));
  }, [uploadedFiles, postType]);

  const postTypes = [
    { value: 'general', label: 'General Post', icon: MessageSquare, color: 'bg-blue-500' },
    { value: 'help', label: 'Help Request', icon: HelpCircle, color: 'bg-red-500' },
    { value: 'offer', label: 'Offering Help', icon: Megaphone, color: 'bg-green-500' },
    { value: 'alert', label: 'Alert/Warning', icon: AlertCircle, color: 'bg-orange-500' },
    { value: 'emergency', label: 'Emergency', icon: AlertCircle, color: 'bg-red-600' },
  ];

  const getCurrentLocation = () => {
    setIsGettingLocation(true);

    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      setIsGettingLocation(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setAutoLocation({ latitude, longitude });
        // Reverse geocode for human-readable address
        const addr = await reverseGeocode(latitude, longitude);
        setLocation(addr);
        setIsGettingLocation(false);
      },
      (error) => {
        console.error('Error getting location:', error);
        alert('Unable to get your location. Please enter it manually.');
        setIsGettingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleCameraCapture = async (fileData) => {
    // Add to preview immediately with uploading state
    const withUploading = { ...fileData, uploading: true, backendUrl: null, analysis: null };
    setUploadedFiles((prev) => [...prev, withUploading]);
    setPendingUploads((n) => n + 1);

    // If photo has GPS location, auto-fill location field with human-readable address
    if (fileData.geotag && fileData.geotag.latitude != null && fileData.geotag.longitude != null) {
      setAutoLocation(fileData.geotag);
      if (fileData.address && fileData.address.full) {
        setLocation(fileData.address.full);
      } else {
        // Resolve via nominatim
        reverseGeocode(fileData.geotag.latitude, fileData.geotag.longitude).then(setLocation);
      }
    }

    // Upload to backend
    try {
      const formData = new FormData();
      formData.append('file', fileData.file);
      formData.append('description', content || '');
      const res = await axios.post(`${API_URL}/api/community/upload-image`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const { url, analysis, local_url, cdn_url } = res.data;

      setUploadedFiles((prev) => {
        const updated = prev.map((f) =>
          f.id === fileData.id
            ? {
                ...f,
                uploading: false,
                backendUrl: url,
                localUrl: local_url || url,
                cdnUrl: cdn_url || null,
                analysis,
              }
            : f
        );

        // After upload: if AI detected a disaster, auto-fill content & tags (if blank)
        const imageAnalysis = analysis?.analysis;
        if (imageAnalysis && imageAnalysis.disaster_type !== 'none') {
          const generatedDescription = getGeneratedDescription(imageAnalysis);
          // Auto-fill content if user hasn't typed yet
          if (!content.trim() && generatedDescription) {
            setContent(generatedDescription);
          }
          // Auto-add tags (avoid duplicates)
          const suggested = buildTagsFromAnalysis(imageAnalysis);
          setTags((prev) => {
            const merged = [...prev];
            suggested.forEach((t) => { if (!merged.includes(t)) merged.push(t); });
            return merged;
          });
          // Suggest post type
          const sugType = suggestPostType(imageAnalysis);
          if (sugType) setPostType(sugType);
        }

        return updated;
      });
    } catch (err) {
      console.error('Image upload failed:', err);
      // Keep the file but mark upload failed; we'll skip it on submit
      setUploadedFiles((prev) =>
        prev.map((f) => f.id === fileData.id ? { ...f, uploading: false, uploadError: true } : f)
      );
    } finally {
      setPendingUploads((n) => n - 1);
    }
  };

  const removeFile = (fileId) => {
    setUploadedFiles(uploadedFiles.filter(f => f.id !== fileId));
  };

  const handleSubmit = () => {
    if (pendingUploads > 0) {
      alert('Please wait for images to finish uploading');
      return;
    }

    const blockReason = getImageBlockReason(uploadedFiles, postType);
    if (blockReason) {
      alert(`⚠️ ${blockReason}`);
      return;
    }

    const generatedDescription = uploadedFiles
      .map((f) => getGeneratedDescription(f.analysis?.analysis))
      .find((d) => d && d.trim()) || '';
    const finalContent = (content || '').trim() || generatedDescription.trim();
    if (!finalContent) {
      alert('Please enter post content or upload an image for AI-generated description.');
      return;
    }

    const geotaggedSources = uploadedFiles
      .map((f) => ({ geotag: f.geotag, address: f.address }))
      .filter((entry) => entry?.geotag && entry.geotag.latitude != null && entry.geotag.longitude != null)
      .sort((a, b) => {
        const accA = Number.isFinite(Number(a?.geotag?.accuracy)) ? Number(a.geotag.accuracy) : Number.POSITIVE_INFINITY;
        const accB = Number.isFinite(Number(b?.geotag?.accuracy)) ? Number(b.geotag.accuracy) : Number.POSITIVE_INFINITY;
        return accA - accB;
      });
    const bestGeo = geotaggedSources[0] || null;

    const finalLat = bestGeo?.geotag?.latitude ?? autoLocation?.latitude ?? null;
    const finalLon = bestGeo?.geotag?.longitude ?? autoLocation?.longitude ?? null;
    const finalPincode = (bestGeo?.address?.pincode || '').trim() || undefined;
    const finalLocation =
      (bestGeo?.address?.full || '').trim()
      || (location || '').trim()
      || 'Unknown';

    // Build media array from successfully uploaded files
    const media = uploadedFiles
      .filter((f) => f.backendUrl)
      .map((f) => ({
        url: f.backendUrl,
        local_url: f.localUrl || null,
        cdn_url: f.cdnUrl || null,
        type: f.type || 'image/jpeg',
        name: f.name,
        geotag: f.geotag || null,
        analysis: f.analysis || null,
      }));

    // Collect image analysis for the best match
    const imageAnalysis = uploadedFiles
      .map((f) => f.analysis?.analysis)
      .filter(Boolean)
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0] || null;

    const post = {
      type: postType,
      title: title.trim(),
      content: finalContent,
      location: finalLocation,
      lat: finalLat,
      lon: finalLon,
      pincode: finalPincode,
      tags,
      media,
      image_analysis: imageAnalysis,
      author: user?.name || user?.email || 'Community Member',
      author_photo: user?.photoURL || null,
      user_id: user?.id || 'anonymous',
    };

    onPostCreated?.(post);
    resetForm();
    onClose();
  };

  const resetForm = () => {
    setPostType('general');
    setTitle('');
    setContent('');
    // Restore city-level cached location after reset
    setLocation(userLocation?.display || '');
    setAutoLocation(userLocation ? { latitude: userLocation.lat, longitude: userLocation.lon } : null);
    setTags([]);
    setTagInput('');
    setUploadedFiles([]);
    setPendingUploads(0);
    setImageBlockReason(null);
  };

  const selectedPostType = postTypes.find(pt => pt.value === postType);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Community Post</DialogTitle>
          <DialogDescription>
            Share updates, ask for help, or report incidents in your area
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Post Type Selector */}
          <div className="space-y-2">
            <Label>Post Type</Label>
            <Select value={postType} onValueChange={setPostType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {postTypes.map((type) => {
                  const Icon = type.icon;
                  return (
                    <SelectItem key={type.value} value={type.value}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${type.color}`} />
                        <Icon className="w-4 h-4" />
                        {type.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Title (optional) */}
          <div className="space-y-2">
            <Label htmlFor="title">Title (Optional)</Label>
            <Input
              id="title"
              placeholder="Brief headline for your post..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Content */}
          <div className="space-y-2">
            <Label htmlFor="content">
              Content <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="content"
              placeholder="Describe the situation, ask for help, or share information..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              {content.length} characters
            </p>
          </div>

          {/* Location */}
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <div className="flex gap-2">
              <Input
                id="location"
                placeholder="Enter location or use GPS..."
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={getCurrentLocation}
                disabled={isGettingLocation}
                className="gap-2"
              >
                <MapPin className="w-4 h-4" />
                {isGettingLocation ? 'Getting...' : 'GPS'}
              </Button>
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <div className="flex gap-2">
              <Input
                id="tags"
                placeholder="Add tags (e.g., flood, emergency)..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={addTag}>
                <Tag className="w-4 h-4" />
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    #{tag}
                    <X
                      className="w-3 h-3 cursor-pointer"
                      onClick={() => removeTag(tag)}
                    />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Camera Capture */}
          <div className="space-y-2">
            <Label>Photo Attachment</Label>
            <div className="space-y-3">
              {/* Camera Button */}
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 border-dashed"
                onClick={() => setIsCameraOpen(true)}
              >
                <Camera className="w-5 h-5" />
                Open Camera (Secure Capture with GPS)
              </Button>

              {/* Photo Preview */}
              {uploadedFiles.length > 0 && (
                <div className="border rounded-lg p-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground">CAPTURED PHOTOS</p>
                  <div className="grid grid-cols-2 gap-3">
                    {uploadedFiles.map((file) => (
                      <div key={file.id} className="relative group">
                        <img
                          src={file.preview}
                          alt={file.name}
                          className="w-full h-32 object-cover rounded-lg border"
                        />
                        {/* Upload spinner */}
                        {file.uploading && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
                            <Loader2 className="w-6 h-6 text-white animate-spin" />
                          </div>
                        )}
                        {/* Upload error */}
                        {file.uploadError && (
                          <div className="absolute inset-0 flex items-center justify-center bg-red-900/60 rounded-lg">
                            <p className="text-white text-xs text-center px-2">Upload failed</p>
                          </div>
                        )}
                        <Button
                          size="icon"
                          variant="destructive"
                          className="absolute top-2 right-2 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeFile(file.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                        {/* Location Badge */}
                        {file.geotag && file.geotag.latitude && (
                          <Badge 
                            variant="secondary" 
                            className="absolute bottom-2 left-2 text-[10px] px-1.5 py-0.5 bg-black/70 text-white border-0"
                          >
                            <MapPin className="w-2.5 h-2.5 mr-0.5" />
                            GPS: {file.geotag.accuracy ? `±${Math.round(file.geotag.accuracy)}m` : 'Yes'}
                          </Badge>
                        )}
                        {/* AI Analysis Badge */}
                        {file.analysis?.analysis && file.analysis.analysis.disaster_type !== 'none' && (
                          <Badge
                            className={`absolute top-2 left-2 text-[10px] px-1.5 py-0.5 text-white border-0 ${SEVERITY_COLOR[file.analysis.analysis.severity] || 'bg-gray-600'}`}
                          >
                            {DISASTER_EMOJI[file.analysis.analysis.disaster_type] || '⚠️'} {file.analysis.analysis.disaster_type} · {file.analysis.analysis.severity}
                          </Badge>
                        )}
                        {file.analysis?.analysis?.authenticity && (
                          <Badge
                            className={`absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 text-white border-0 ${AUTHENTICITY_COLOR[file.analysis.analysis.authenticity] || 'bg-gray-700'}`}
                          >
                            {AUTHENTICITY_LABEL[file.analysis.analysis.authenticity] || 'Unverified'}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {uploadedFiles.length} photo{uploadedFiles.length > 1 ? 's' : ''} attached with GPS data
                    {pendingUploads > 0 && <span className="text-orange-500 ml-1">(uploading...)</span>}
                  </p>
                </div>
              )}

              {/* Security Notice */}
              <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/20 p-2 rounded border border-blue-200">
                🔒 <strong>Secure Mode:</strong> Photos are captured live with GPS coordinates. 
                No file uploads allowed to prevent misuse.
              </div>
            </div>
          </div>

          {/* Camera Capture Modal */}
          <CameraCapture
            isOpen={isCameraOpen}
            onClose={() => setIsCameraOpen(false)}
            onCapture={handleCameraCapture}
          />

          {/* Post Preview */}
          {content && (
            <div className="border rounded-lg p-4 bg-muted/50">
              <p className="text-xs font-semibold mb-2 text-muted-foreground">PREVIEW</p>
              {title && <h4 className="font-semibold mb-1">{title}</h4>}
              <p className="text-sm whitespace-pre-wrap">{content}</p>
              {location && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
                  <MapPin className="w-3 h-3" />
                  {location}
                </div>
              )}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      #{tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-4 border-t">
          <div className="flex items-center gap-2">
            {selectedPostType && (
              <Badge variant="outline" className={`${selectedPostType.color} text-white`}>
                {selectedPostType.label}
              </Badge>
            )}
            {(postType === 'alert' || postType === 'emergency') && (
              <span className="text-xs text-amber-700 dark:text-amber-300">
                This post will be reviewed by admin before it becomes public.
              </span>
            )}
          </div>

          {/* AI Block Warning */}
          {imageBlockReason && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-300 dark:border-red-700">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-700 dark:text-red-400">Image Not Relevant</p>
                <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">{imageBlockReason}</p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { resetForm(); onClose(); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} className="gap-2" disabled={pendingUploads > 0 || !!imageBlockReason}>
              {pendingUploads > 0 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {pendingUploads > 0 ? 'Uploading...' : 'Post'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreatePostModal;

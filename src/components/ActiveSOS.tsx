import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, AlertTriangle, MapPin, Camera, Mic, CheckCircle2 } from 'lucide-react';
import { AppConfig, SOSStatus, Evidence } from '../types';

interface ActiveSOSProps {
  status: SOSStatus;
  config: AppConfig;
  notificationStatus: 'idle' | 'sending' | 'sent' | 'failed';
  onCancel: (code: string) => void;
  onComplete: () => void;
  onEvidenceCaptured: (evidence: Evidence) => void;
}

export default function ActiveSOS({ status, config, notificationStatus, onCancel, onComplete, onEvidenceCaptured }: ActiveSOSProps) {
  const [countdown, setCountdown] = useState(config.deadManTimeout);
  const [cancelCode, setCancelCode] = useState('');
  const [isStealth, setIsStealth] = useState(false);
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [isMediaReady, setIsMediaReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (status === 'dead-man-switch' && countdown > 0) {
      const timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (status === 'dead-man-switch' && countdown === 0) {
      onComplete();
    }
  }, [status, countdown, onComplete]);

  // Auto-activate stealth mode after 5 seconds of SOS being active
  useEffect(() => {
    if (status === 'active') {
      const timer = setTimeout(() => {
        setIsStealth(true);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // Listen for Escape or Volume Up keys to exit stealth mode
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // 175 is standard VolumeUp keyCode, 24 is Android VolumeUp keyCode
      if (isStealth && (
        e.key === 'Escape' || 
        e.key === 'AudioVolumeUp' || 
        e.key === 'VolumeUp' || 
        e.code === 'VolumeUp' ||
        e.keyCode === 175 || 
        e.keyCode === 24
      )) {
        setIsStealth(false);
      }
    };

    // Use capture phase to ensure we catch the event before anything else
    // Listen to both keydown and keyup as some mobile browsers only fire keyup for hardware buttons
    document.addEventListener('keydown', handleKey, true);
    document.addEventListener('keyup', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      document.removeEventListener('keyup', handleKey, true);
    };
  }, [isStealth]);

  // Initialize camera/mic when SOS becomes active
  useEffect(() => {
    if (status === 'active') {
      const initMedia = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: (config.evidence.camera || config.evidence.video) ? { 
              facingMode: 'user',
              width: { ideal: 1280 },
              height: { ideal: 720 }
            } : false, 
            audio: config.evidence.audio ? {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 44100
            } : false 
          });
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.onloadedmetadata = () => {
              videoRef.current?.play().catch(e => console.error("Video play failed:", e));
              setIsMediaReady(true);
            };
          } else {
            // If no video element (stealth), we still need to mark as ready for audio
            setIsMediaReady(true);
          }
        } catch (err) {
          console.error("Error accessing media devices:", err);
          // Fallback: try audio only if video fails
          if (config.evidence.camera || config.evidence.video) {
            try {
              const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
              streamRef.current = audioStream;
              setIsMediaReady(true);
            } catch (audioErr) {
              console.error("Audio-only fallback failed:", audioErr);
            }
          }
        }
      };
      initMedia();

      return () => {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
      };
    }
  }, [status, config.evidence]);

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !config.evidence.camera || !isMediaReady) {
      console.warn("Capture photo skipped: media not ready or camera disabled");
      return null;
    }
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Ensure video has dimensions and is playing
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.warn("Capture photo skipped: video dimensions are 0");
      return null;
    }

    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        console.log("Photo captured successfully, length:", dataUrl.length);
        return dataUrl;
      }
    } catch (err) {
      console.error("Error in capturePhoto:", err);
    }
    return null;
  }, [config.evidence.camera, isMediaReady]);

  // Continuous Audio Recording Loop
  useEffect(() => {
    if (status === 'active' && config.evidence.audio && isMediaReady && streamRef.current) {
      let isComponentMounted = true;
      let currentRecorder: MediaRecorder | null = null;
      
      const recordSnippet = async () => {
        if (!isComponentMounted || !streamRef.current || status !== 'active') return;

        const audioTrack = streamRef.current.getAudioTracks()[0];
        if (!audioTrack || audioTrack.readyState !== 'live') {
          console.warn("Audio track not ready, retrying in 1s...");
          setTimeout(recordSnippet, 1000);
          return;
        }

        try {
          const audioTrack = streamRef.current.getAudioTracks()[0];
          if (!audioTrack || audioTrack.readyState !== 'live') {
            console.warn("Audio track not ready or live, retrying in 1s...");
            setTimeout(recordSnippet, 1000);
            return;
          }

          if (!streamRef.current.active) {
            console.warn("Stream is not active, retrying in 1s...");
            setTimeout(recordSnippet, 1000);
            return;
          }

          // Create a dedicated audio-only stream
          const audioOnlyStream = new MediaStream([audioTrack]);

          const mimeTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
            'audio/aac'
          ];
          
          let supportedType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
          console.log(`Attempting to start MediaRecorder with type: ${supportedType || 'default'}`);
          
          const options: MediaRecorderOptions = {};
          if (supportedType) {
            options.mimeType = supportedType;
          }
          
          // Try to initialize without bitsPerSecond first for maximum compatibility
          const recorder = new MediaRecorder(audioOnlyStream, options);
          currentRecorder = recorder;
          const chunks: Blob[] = [];

          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };

          recorder.onstop = async () => {
            const capturedChunks = [...chunks];
            if (capturedChunks.length > 0) {
              const blob = new Blob(capturedChunks, { type: recorder.mimeType || supportedType || 'audio/webm' });
              const reader = new FileReader();
              reader.onloadend = async () => {
                const base64 = reader.result as string;
                const id = Math.random().toString(36).substr(2, 9);
                const timestamp = new Date();

                try {
                  const response = await fetch('/api/evidence/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, type: 'audio', data: base64, timestamp }),
                  });
                  const result = await response.json();
                  // We still want to notify the parent even if unmounting, 
                  // as the App component is still mounted and can update its evidence list.
                  if (result.success) {
                    onEvidenceCaptured({ id, type: 'audio', timestamp, url: result.url });
                    if (isComponentMounted) {
                      setEvidenceCount(prev => prev + 1);
                    }
                  }
                } catch (error) {
                  console.error("Audio snippet upload failed:", error);
                }
              };
              reader.readAsDataURL(blob);
            }
            
            // Immediately start the next snippet ONLY if the component is still mounted 
            // AND the SOS is still active.
            if (isComponentMounted && status === 'active') {
              recordSnippet();
            }
          };

          // Use a small delay before starting to ensure the stream is fully "warm"
          setTimeout(() => {
            try {
              if (recorder.state === 'inactive' && isComponentMounted && status === 'active') {
                recorder.start(1000);
                console.log("MediaRecorder started successfully");
              }
            } catch (startErr) {
              console.error("Failed to start MediaRecorder after delay:", startErr);
              setTimeout(recordSnippet, 2000);
            }
          }, 500);
          
          // Record in 30-second "chapters" for better reliability
          setTimeout(() => {
            if (recorder.state === 'recording') {
              recorder.stop();
            }
          }, 30000);
        } catch (err) {
          console.error("MediaRecorder initialization failed:", err);
          setTimeout(recordSnippet, 2000);
        }
      };

      // Small delay to ensure stream is stable
      const initialTimeout = setTimeout(recordSnippet, 1000);
      
      return () => { 
        isComponentMounted = false;
        clearTimeout(initialTimeout);
        if (currentRecorder && currentRecorder.state === 'recording') {
          currentRecorder.stop();
        }
      };
    }
  }, [status, config.evidence.audio, isMediaReady, onEvidenceCaptured]);

  // Continuous Video Recording Loop
  useEffect(() => {
    if (status === 'active' && config.evidence.video && isMediaReady && streamRef.current) {
      let isComponentMounted = true;
      let currentRecorder: MediaRecorder | null = null;
      
      const recordSnippet = async () => {
        if (!isComponentMounted || !streamRef.current || status !== 'active') return;

        const videoTrack = streamRef.current.getVideoTracks()[0];
        const audioTrack = streamRef.current.getAudioTracks()[0];
        
        if (!videoTrack || videoTrack.readyState !== 'live') {
          console.warn("Video track not ready, retrying in 1s...");
          setTimeout(recordSnippet, 1000);
          return;
        }

        try {
          if (!streamRef.current.active) {
            console.warn("Stream is not active, retrying in 1s...");
            setTimeout(recordSnippet, 1000);
            return;
          }

          // Create a dedicated stream for video recording
          const tracks = [videoTrack];
          if (audioTrack) tracks.push(audioTrack);
          const videoStream = new MediaStream(tracks);

          const mimeTypes = [
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4'
          ];
          
          let supportedType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
          console.log(`Attempting to start Video MediaRecorder with type: ${supportedType || 'default'}`);
          
          const options: MediaRecorderOptions = {};
          if (supportedType) {
            options.mimeType = supportedType;
          }
          
          const recorder = new MediaRecorder(videoStream, options);
          currentRecorder = recorder;
          const chunks: Blob[] = [];

          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              chunks.push(e.data);
            }
          };

          recorder.onstop = async () => {
            const capturedChunks = [...chunks];
            if (capturedChunks.length > 0) {
              const blob = new Blob(capturedChunks, { type: recorder.mimeType || supportedType || 'video/webm' });
              const reader = new FileReader();
              reader.onloadend = async () => {
                const base64 = reader.result as string;
                const id = Math.random().toString(36).substr(2, 9);
                const timestamp = new Date();

                try {
                  const response = await fetch('/api/evidence/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, type: 'video', data: base64, timestamp }),
                  });
                  const result = await response.json();
                  if (result.success) {
                    onEvidenceCaptured({ id, type: 'video', timestamp, url: result.url });
                    if (isComponentMounted) {
                      setEvidenceCount(prev => prev + 1);
                    }
                  }
                } catch (error) {
                  console.error("Video snippet upload failed:", error);
                }
              };
              reader.readAsDataURL(blob);
            } else {
              console.warn("No video chunks captured in this snippet");
            }
            
            if (isComponentMounted && status === 'active') {
              recordSnippet();
            }
          };

          setTimeout(() => {
            try {
              if (recorder.state === 'inactive' && isComponentMounted && status === 'active') {
                recorder.start(1000); // 1 second timeslice ensures chunks are pushed regularly
              }
            } catch (startErr) {
              console.error("Failed to start Video MediaRecorder:", startErr);
              setTimeout(recordSnippet, 2000);
            }
          }, 500);
          
          // Record in 5-second "chapters" for video to avoid huge files and upload quickly
          setTimeout(() => {
            if (recorder.state === 'recording') {
              recorder.stop();
            }
          }, 5000);
        } catch (err) {
          console.error("Video MediaRecorder initialization failed:", err);
          setTimeout(recordSnippet, 2000);
        }
      };

      const initialTimeout = setTimeout(recordSnippet, 1000);
      
      return () => { 
        isComponentMounted = false;
        clearTimeout(initialTimeout);
        if (currentRecorder && currentRecorder.state === 'recording') {
          currentRecorder.stop();
        }
      };
    }
  }, [status, config.evidence.video, isMediaReady, onEvidenceCaptured]);

  // Photo Capture Loop (Separate from Audio)
  useEffect(() => {
    if (status === 'active' && config.evidence.camera && isMediaReady) {
      const interval = setInterval(async () => {
        const data = await capturePhoto();
        if (data) {
          const id = Math.random().toString(36).substr(2, 9);
          const timestamp = new Date();
          try {
            const response = await fetch('/api/evidence/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, type: 'photo', data, timestamp }),
            });
            const result = await response.json();
            if (result.success) {
              setEvidenceCount(prev => prev + 1);
              onEvidenceCaptured({ id, type: 'photo', timestamp, url: result.url });
            }
          } catch (error) {
            console.error("Photo upload failed:", error);
          }
        }
      }, 10000); // Capture photo every 10 seconds
      return () => clearInterval(interval);
    }
  }, [status, config.evidence.camera, isMediaReady, capturePhoto, onEvidenceCaptured]);

  const handleCancelSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCancel(cancelCode);
    setCancelCode('');
  };

  return (
    <div className="fixed inset-0 bg-zinc-950 text-white z-[100] overflow-y-auto">
      <div className="min-h-full w-full flex flex-col items-center justify-center p-6 pb-12">
        <AnimatePresence mode="wait">
          {isStealth && status === 'active' ? (
            <motion.div 
              key="stealth-mode"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black z-[100] cursor-none flex items-center justify-center outline-none"
              onClick={() => setIsStealth(false)}
              tabIndex={0}
              ref={(el) => el?.focus()}
            >
              {/* Completely black screen for stealth */}
              <div className="text-[10px] text-zinc-900 select-none">System Idle</div>
            </motion.div>
          ) : status === 'dead-man-switch' ? (
            <motion.div 
              key="dead-man"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="w-full max-w-sm space-y-8 text-center py-8"
            >
              <div className="relative inline-block">
                <div className="w-32 h-32 rounded-full border-4 border-orange-500/20 flex items-center justify-center">
                  <span className="text-5xl font-bold text-orange-500">{countdown}</span>
                </div>
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 border-t-4 border-orange-500 rounded-full"
                />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-bold">Dead Man Switch</h2>
                <p className="text-zinc-400">SOS will be sent in {countdown} seconds unless you enter the cancel code.</p>
              </div>

              <form onSubmit={handleCancelSubmit} className="space-y-4">
                <input 
                  type="password"
                  value={cancelCode}
                  onChange={(e) => setCancelCode(e.target.value)}
                  placeholder="Enter Cancel Code"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-center text-2xl tracking-[1em] focus:outline-none focus:border-orange-500"
                  autoFocus
                />
                <button 
                  type="submit"
                  className="w-full py-4 bg-zinc-800 rounded-2xl font-bold hover:bg-zinc-700 transition-colors"
                >
                  Cancel SOS
                </button>
              </form>
            </motion.div>
          ) : (
            <motion.div 
              key="active-sos"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full flex flex-col py-8"
            >
              <div className="flex-1 flex flex-col items-center justify-center space-y-8">
                <motion.div 
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-24 h-24 bg-red-600 rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(220,38,38,0.5)]"
                >
                  <AlertTriangle size={48} />
                </motion.div>

                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-bold text-red-500 uppercase tracking-tighter">SOS Active</h2>
                  <p className="text-zinc-400">
                    {notificationStatus === 'sending' && "Sending emergency alerts..."}
                    {notificationStatus === 'sent' && "Emergency alerts sent to contacts."}
                    {(notificationStatus === 'idle' || notificationStatus === 'failed') && "Emergency services notified."}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 w-full max-w-[320px]">
                  <SOSIndicator icon={MapPin} label="Location" active={true} />
                  <SOSIndicator 
                    icon={Mic} 
                    label="Audio" 
                    active={config.evidence.audio && isMediaReady} 
                    status={isMediaReady ? "Recording" : "Initializing"}
                  />
                  <SOSIndicator 
                    icon={Camera} 
                    label="Camera" 
                    active={config.evidence.camera && isMediaReady} 
                    status={isMediaReady ? "Capturing" : "Initializing"}
                  />
                  <SOSIndicator icon={Shield} label="Cloud" active={true} />
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 w-full max-w-[320px]">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">Evidence Collected</span>
                    <span className="text-xs font-bold text-orange-500">{evidenceCount} Files</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: "100%" }}
                      transition={{ duration: 5, repeat: Infinity }}
                      className="h-full bg-orange-500"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-8 space-y-4">
                <button 
                  onClick={() => setIsStealth(true)}
                  className="w-full py-4 bg-zinc-900 border border-zinc-800 rounded-2xl font-bold hover:bg-zinc-800 transition-colors"
                >
                  Enter Stealth Mode
                </button>
                <button 
                  onClick={() => onCancel('1234')} // Simplified for demo
                  className="w-full py-4 bg-red-600/10 text-red-500 border border-red-600/20 rounded-2xl font-bold hover:bg-red-600/20 transition-colors"
                >
                  End Emergency
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      {/* Hidden elements for media capture - using opacity-0 instead of hidden to ensure rendering */}
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        muted 
        className="fixed top-0 left-0 w-32 h-32 opacity-0 pointer-events-none z-[-1]" 
      />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

function SOSIndicator({ icon: Icon, label, active, status }: { icon: any, label: string, active: boolean, status?: string }) {
  return (
    <div className={`p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all ${active ? 'bg-orange-500/10 border-orange-500/20 text-orange-500' : 'bg-zinc-900 border-zinc-800 text-zinc-600'}`}>
      <Icon size={20} className={active ? 'animate-pulse' : ''} />
      <div className="text-center">
        <span className="block text-[10px] uppercase font-bold tracking-wider">{label}</span>
        {status && <span className="block text-[8px] uppercase font-medium opacity-60">{status}</span>}
      </div>
    </div>
  );
}

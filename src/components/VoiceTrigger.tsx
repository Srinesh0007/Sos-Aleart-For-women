import React, { useEffect, useRef, useState } from 'react';
import { AppConfig } from '../types';

interface VoiceTriggerProps {
  config: AppConfig;
  onTrigger: () => void;
  onImmediateTrigger: () => void;
  isActive: boolean;
  onStatusChange?: (status: 'active' | 'inactive' | 'error' | 'denied') => void;
}

export default function VoiceTrigger({ config, onTrigger, onImmediateTrigger, isActive, onStatusChange }: VoiceTriggerProps) {
  const recognitionRef = useRef<any>(null);
  const [isListening, setIsListening] = useState(false);
  const [lastHeard, setLastHeard] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const screamTriggeredRef = useRef(false);

  // Rolling buffer to catch phrases split across segments
  const transcriptBufferRef = useRef<string[]>([]);
  const MAX_BUFFER_SIZE = 10; // Keep last 10 segments

  // Refs to prevent stale closures in event listeners
  const configRef = useRef(config);
  const onTriggerRef = useRef(onTrigger);
  const onImmediateTriggerRef = useRef(onImmediateTrigger);
  const isActiveRef = useRef(isActive);
  const isListeningRef = useRef(isListening);
  const isStartingRef = useRef(false);
  const lastResultTimeRef = useRef(Date.now());
  const sessionStartTimeRef = useRef(Date.now());
  const restartTimeoutRef = useRef<any>(null);

  const permissionDeniedRef = useRef(false);

  useEffect(() => {
    configRef.current = config;
    onTriggerRef.current = onTrigger;
    onImmediateTriggerRef.current = onImmediateTrigger;
    isActiveRef.current = isActive;
    isListeningRef.current = isListening;
    
    // Reset permission denied flag if active state changes to true (user might have re-enabled it)
    if (isActive) {
       // Don't auto-reset permissionDeniedRef here to avoid loops, 
       // but allow manual interaction to reset it.
    }

    // Report status
    if (error === 'Microphone access denied') {
      onStatusChange?.('denied');
    } else if (error) {
      onStatusChange?.('error');
    } else if (isListening) {
      onStatusChange?.('active');
    } else {
      onStatusChange?.('inactive');
    }
  }, [config, onTrigger, onImmediateTrigger, isActive, isListening, error, onStatusChange]);

  // Keywords that trigger SOS in multiple languages
  const DANGER_KEYWORDS = [
    // English
    'help', 'help me', 'emergency', 'police', 'stop it', 'get away', 
    'danger', 'sos', 'save me', 'call 911', 'mayday', 'security',
    'attack', 'rape', 'kidnap', 'murder', 'killer', 'weapon', 'gun', 'knife',
    'held', 'health', 'hell', // Phonetic misinterpretations of 'help'
    // Spanish
    'ayuda', 'socorro', 'emergencia', 'policía', 'déjame', 'vete',
    // French
    'aide', 'au secours', 'urgence', 'police', 'arrête',
    // German
    'hilfe', 'notfall', 'polizei', 'stopp', 'aufhören',
    // Italian
    'aiuto', 'emergenza', 'polizia',
    // Portuguese
    'ajuda', 'socorro', 'emergência',
    // Hindi (Latin & Devanagari)
    'bachao', 'madad', 'बचाओ', 'मदद', 'bachao mujhe',
    // Chinese
    '救命', '报警', '救救我',
    // Japanese
    '助けて', '警察', 'たすけて',
    // Korean
    '도와주세요', '경찰',
    // Russian
    'помощь', 'полиция', 'помогите',
    // Arabic
    'مساعدة', 'شرطة', 'ساعدوني'
  ];

  useEffect(() => {
    if (!isActive || !config.aiDetection.voice) {
      stopListening();
      return;
    }

    // Clear any pending restarts
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);

    // Small delay to ensure any previous recognition instance has fully shut down
    restartTimeoutRef.current = setTimeout(() => {
      startListening();
    }, 500);

    const handleInteraction = () => {
      // Allow manual restart even if permission was denied previously
      if (isActiveRef.current && configRef.current.aiDetection.voice) {
         console.log('User interaction: checking voice engine...');
         permissionDeniedRef.current = false; 
         
         if (!isStartingRef.current) {
            console.log('User interaction: forcing engine restart');
            startListening();
         }
      }
    };

    window.addEventListener('click', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);

    const watchdog = setInterval(() => {
      const now = Date.now();
      const timeSinceLastResult = now - lastResultTimeRef.current;
      const sessionDuration = now - sessionStartTimeRef.current;

      // If supposed to be active but not listening, and not currently starting, AND permission not denied
      if (isActiveRef.current && configRef.current.aiDetection.voice && !isListeningRef.current && !isStartingRef.current && !permissionDeniedRef.current) {
        console.log('Watchdog: Mic inactive, restarting...');
        startListening();
      }
      
      // If listening but silence for too long (10s), refresh to keep connection alive
      // Reduced from 15s to 10s for better robustness
      if (isListeningRef.current && timeSinceLastResult > 10000 && !isStartingRef.current) {
        console.log('Watchdog: Engine silent for 10s, refreshing...');
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch (e) {}
        }
      }

      // Hard refresh every 3 minutes (reduced from 5) to prevent memory leaks or stale sessions
      if (isListeningRef.current && sessionDuration > 180000 && !isStartingRef.current) {
        console.log('Watchdog: 3-minute session refresh...');
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch (e) {}
        }
      }
    }, 4000); // Reduced from 5000 to 4000

    return () => {
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      clearInterval(watchdog);
      stopListening();
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
    };
  }, [isActive, config.aiDetection.voice]);

  const startListening = async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    
    // Cleanup existing
    stopListening();
    
    sessionStartTimeRef.current = Date.now(); 
    lastResultTimeRef.current = Date.now(); 
    setError(null);
    setLastHeard(''); 
    
    console.log('Voice Detection: Starting...', {
      isSecureContext: window.isSecureContext,
      protocol: window.location.protocol
    });

    if (!window.isSecureContext) {
      setError('Insecure context: Use HTTPS');
      isStartingRef.current = false;
      return;
    }
    
    try {
      // 1. Determine Environment
      const isAndroid = /Android/i.test(navigator.userAgent);
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      let tempStream: MediaStream | null = null;

      // 2. Setup Audio Context (Scream Detection)
      // We now try to enable it on Android too, but with more caution
      try {
         tempStream = await navigator.mediaDevices.getUserMedia({ 
           audio: {
             echoCancellation: true,
             noiseSuppression: false, // We want to hear screams!
             autoGainControl: true
           } 
         });
         
         const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
         if (AudioContextClass) {
           const audioContext = new AudioContextClass();
           audioContextRef.current = audioContext;
           const source = audioContext.createMediaStreamSource(tempStream);
           const analyser = audioContext.createAnalyser();
           analyser.fftSize = 256;
           analyserRef.current = analyser;
           source.connect(analyser);
   
           const bufferLength = analyser.frequencyBinCount;
           const dataArray = new Uint8Array(bufferLength);
   
           const checkScream = () => {
             if (!isListeningRef.current || screamTriggeredRef.current) return;
             
             analyser.getByteFrequencyData(dataArray);
             
             // Calculate average volume
             let sum = 0;
             for (let i = 0; i < bufferLength; i++) {
               sum += dataArray[i];
             }
             const average = sum / bufferLength;

             // Calculate high-frequency energy (screams are often high-pitched)
             // Each bin is ~187Hz (at 48kHz)
             // 1.5kHz to 4kHz is roughly bin 8 to 22
             let highFreqSum = 0;
             let highFreqCount = 0;
             for (let i = 8; i < 22; i++) {
               highFreqSum += dataArray[i];
               highFreqCount++;
             }
             const highFreqAverage = highFreqSum / highFreqCount;
             
             // Trigger if overall volume is very high OR high-frequency energy is high
             // Adjusted thresholds for better sensitivity
             if (average > 110 || highFreqAverage > 130) { 
               screamTriggeredRef.current = true;
               console.log("Scream detected! Vol:", average, "HighFreq:", highFreqAverage);
               onImmediateTriggerRef.current();
               return;
             }
             
             requestAnimationFrame(checkScream);
           };
           checkScream();
         }
      } catch (e) {
        console.warn('Scream detection init failed:', e);
      }

      // 3. Setup Keyword Detection (Web Speech API)
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3; // Increased to 3 for better robustness
        recognition.lang = window.navigator.language || 'en-US';

        recognition.onstart = () => {
            console.log('Speech Recognition Service Started');
            setIsListening(true);
            screamTriggeredRef.current = false;
            isStartingRef.current = false;
        };

        recognition.onresult = (event: any) => {
          lastResultTimeRef.current = Date.now();
          const results = event.results;
          
          const i = event.resultIndex;
          if (i < results.length) {
            const currentResults = results[i];
            const isFinal = currentResults.isFinal;
            
            const rawCustom = configRef.current.aiDetection.customVoiceKeyword || '';
            const cleanCustom = rawCustom.toLowerCase().trim();
            
            const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
            const normalizedCustom = normalize(cleanCustom);

            const checkMatch = (text: string) => {
              if (!text) return false;

              // Check Custom Keyword
              if (normalizedCustom && (text === normalizedCustom || text.includes(normalizedCustom))) {
                const words = text.split(/\s+/);
                const keywordWords = normalizedCustom.split(/\s+/);
                if (keywordWords.length === 1 && normalizedCustom.length < 4) {
                  return words.includes(normalizedCustom);
                }
                return true;
              }

              // Check Danger Keywords
              return DANGER_KEYWORDS.some(keyword => {
                const normalizedK = normalize(keyword);
                if (text === normalizedK || text.includes(normalizedK)) {
                  const words = text.split(/\s+/);
                  if (normalizedK.length < 4) return words.includes(normalizedK);
                  return true;
                }
                return false;
              });
            };

            // Check all alternatives (up to 3)
            for (let j = 0; j < currentResults.length; j++) {
              const transcript = currentResults[j].transcript;
              const normalizedTranscript = normalize(transcript);
              
              if (checkMatch(normalizedTranscript)) {
                console.log("Triggered by keyword (alt " + j + "):", normalizedTranscript);
                onImmediateTriggerRef.current();
                try { recognition.stop(); } catch (e) {}
                return;
              }
            }

            // Update buffer with the best result if final
            if (isFinal) {
              const bestTranscript = normalize(currentResults[0].transcript);
              transcriptBufferRef.current.push(bestTranscript);
              if (transcriptBufferRef.current.length > MAX_BUFFER_SIZE) {
                transcriptBufferRef.current.shift();
              }
              
              // Combine last 3 segments for context (handles split phrases)
              const context = transcriptBufferRef.current.slice(-3).join(' ');
              if (checkMatch(context)) {
                console.log("Triggered by context:", context);
                onImmediateTriggerRef.current();
                try { recognition.stop(); } catch (e) {}
                return;
              }
              setLastHeard(currentResults[0].transcript);
            }
          }
        };

        recognition.onerror = (event: any) => {
          if (event.error === 'no-speech' || event.error === 'network' || event.error === 'aborted') {
            return;
          }
          
          console.error('Speech recognition error:', event.error);
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
             setError('Microphone access denied');
             setIsListening(false);
             permissionDeniedRef.current = true;
          }
          isStartingRef.current = false;
        };

        recognition.onend = () => {
          setIsListening(false);
          isStartingRef.current = false;
          
          if (isActiveRef.current && configRef.current.aiDetection.voice && !permissionDeniedRef.current) {
            console.log('Speech recognition ended, scheduling restart...');
            
            const isAndroid = /Android/i.test(navigator.userAgent);
            const restartDelay = isAndroid ? 800 : 200; // Increased delay for Android stability

            if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
            restartTimeoutRef.current = setTimeout(() => {
               if (isActiveRef.current && configRef.current.aiDetection.voice) {
                 startListening();
               }
            }, restartDelay);
          }
        };

        try {
          recognition.start();
          recognitionRef.current = recognition;
        } catch (e) {
          console.error('Failed to start recognition:', e);
          isStartingRef.current = false;
        }
      } else {
        setError('Speech API not supported');
        isStartingRef.current = false;
      }

    } catch (error) {
      console.error('Error starting voice detection:', error);
      setError('Failed to start');
      isStartingRef.current = false;
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (e) {}
      recognitionRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (e) {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setIsListening(false);
  };

  if (!isActive) return null;

  // Stealth mode: Render nothing visible to maintain the calculator disguise
  return null;
}

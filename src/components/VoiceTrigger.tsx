import React, { useEffect, useRef, useState } from 'react';
import { AppConfig } from '../types';

interface VoiceTriggerProps {
  config: AppConfig;
  onTrigger: () => void;
  onImmediateTrigger: () => void;
  isActive: boolean;
}

export default function VoiceTrigger({ config, onTrigger, onImmediateTrigger, isActive }: VoiceTriggerProps) {
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

  useEffect(() => {
    configRef.current = config;
    onTriggerRef.current = onTrigger;
    onImmediateTriggerRef.current = onImmediateTrigger;
    isActiveRef.current = isActive;
    isListeningRef.current = isListening;
  }, [config, onTrigger, onImmediateTrigger, isActive, isListening]);

  // Keywords that trigger SOS in multiple languages
  const DANGER_KEYWORDS = [
    // English
    'help', 'help me', 'emergency', 'police', 'stop it', 'get away', 
    'danger', 'sos', 'save me', 'call 911', 'mayday', 'security',
    // Spanish
    'ayuda', 'socorro', 'emergencia', 'policía',
    // French
    'aide', 'au secours', 'urgence',
    // German
    'hilfe', 'notfall', 'polizei',
    // Italian
    'aiuto', 'emergenza',
    // Portuguese
    'ajuda', 'socorro',
    // Hindi (Latin & Devanagari)
    'bachao', 'madad', 'बचाओ', 'मदद',
    // Chinese
    '救命', '报警',
    // Japanese
    '助けて', '警察',
    // Korean
    '도와주세요', '경찰',
    // Russian
    'помощь', 'полиция',
    // Arabic
    'مساعدة', 'شرطة'
  ];

  useEffect(() => {
    if (!isActive || !config.aiDetection.voice) {
      stopListening();
      return;
    }

    // Small delay to ensure any previous recognition instance has fully shut down
    const timer = setTimeout(() => {
      startListening();
    }, 500);

    const handleInteraction = () => {
      if (!isListeningRef.current && isActiveRef.current && configRef.current.aiDetection.voice) {
         console.log('User interaction: attempting to wake up voice engine');
         startListening();
      }
    };

    window.addEventListener('click', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);

    const watchdog = setInterval(() => {
      const now = Date.now();
      const timeSinceLastResult = now - lastResultTimeRef.current;
      const sessionDuration = now - sessionStartTimeRef.current;

      if (isActiveRef.current && configRef.current.aiDetection.voice && !isListeningRef.current && !isStartingRef.current) {
        console.log('Watchdog: Mic inactive, restarting...');
        startListening();
      }
      
      if (isListeningRef.current && timeSinceLastResult > 15000 && !isStartingRef.current) {
        console.log('Watchdog: Engine silent for 15s, refreshing...');
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch (e) {}
        }
      }

      if (isListeningRef.current && sessionDuration > 300000 && !isStartingRef.current) {
        console.log('Watchdog: 5-minute session refresh...');
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch (e) {}
        }
      }
    }, 5000);

    return () => {
      clearTimeout(timer);
      clearInterval(watchdog);
      stopListening();
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
    };
  }, [isActive, config.aiDetection.voice]);

  const startListening = async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    sessionStartTimeRef.current = Date.now(); // Reset session timer
    lastResultTimeRef.current = Date.now(); // Reset result timer
    setError(null);
    setLastHeard(''); // Clear previous transcript so user sees it's fresh
    
    console.log('Voice Detection: Starting...', {
      isSecureContext: window.isSecureContext,
      protocol: window.location.protocol,
      origin: window.location.origin
    });

    if (!window.isSecureContext) {
      console.error('Voice Detection: Not a secure context! Speech APIs will be disabled.');
      setError('Insecure context: Use HTTPS');
      isStartingRef.current = false;
      return;
    }
    
    try {
      // Explicitly request microphone permission first.
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // 1. Setup Scream Detection (Fast Path)
      // This works independently of speech-to-text and is near-instant
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
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          
          // Threshold for a "scream" or loud shout (0-255 scale)
          // 85 is usually a loud shout, 100+ is a scream
          if (average > 95) {
            screamTriggeredRef.current = true;
            onImmediateTriggerRef.current();
            return;
          }
          
          requestAnimationFrame(checkScream);
        };
        checkScream();
      }

      // 2. Setup Keyword Detection (Web Speech API)
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 10;
        recognition.lang = window.navigator.language || 'en-US';

        recognition.onstart = () => {
            setIsListening(true);
            screamTriggeredRef.current = false;
        };

        recognition.onresult = (event: any) => {
          lastResultTimeRef.current = Date.now();
          const results = event.results;
          
          for (let i = event.resultIndex; i < results.length; i++) {
            const currentResults = results[i];
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

            // Check top alternatives
            for (let j = 0; j < Math.min(currentResults.length, 5); j++) {
              const transcript = currentResults[j].transcript;
              const normalizedTranscript = normalize(transcript);
              
              // 1. Check immediate transcript
              if (checkMatch(normalizedTranscript)) {
                onImmediateTriggerRef.current();
                try { recognition.stop(); } catch (e) {}
                return;
              }

              // 2. Check rolling buffer (combine last few segments to catch split phrases)
              if (currentResults.isFinal) {
                transcriptBufferRef.current.push(normalizedTranscript);
                if (transcriptBufferRef.current.length > MAX_BUFFER_SIZE) {
                  transcriptBufferRef.current.shift();
                }
                
                // Combine last 3 segments for context
                const context = transcriptBufferRef.current.slice(-3).join(' ');
                if (checkMatch(context)) {
                  onImmediateTriggerRef.current();
                  try { recognition.stop(); } catch (e) {}
                  return;
                }
              }
            }
            
            if (currentResults.isFinal) {
              setLastHeard(currentResults[0].transcript);
            }
          }
        };

        recognition.onerror = (event: any) => {
          // Ignore benign errors that happen during normal operation
          if (event.error === 'no-speech' || event.error === 'network' || event.error === 'aborted') {
            console.log(`Speech recognition benign error: ${event.error} (will restart)`);
            return;
          }
          
          console.error('Speech recognition error:', event.error);
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
             setError('Microphone access denied');
             setIsListening(false);
          }
        };

        recognition.onend = () => {
          setIsListening(false);
          // Only restart if we are still supposed to be listening and the ref matches
          if (isActiveRef.current && configRef.current.aiDetection.voice && recognitionRef.current === recognition) {
            console.log('Speech recognition ended, restarting...');
            setTimeout(() => {
               try {
                 if (isActiveRef.current && configRef.current.aiDetection.voice && recognitionRef.current === recognition) {
                   recognition.start();
                 }
               } catch (e) {
                 console.error('Error restarting recognition:', e);
               }
            }, 300);
          }
        };

        try {
          if (recognitionRef.current) {
             recognitionRef.current.stop();
          }
          recognition.start();
          recognitionRef.current = recognition;
        } catch (e) {
          console.error('Failed to start recognition:', e);
        }
      } else {
        console.warn('SpeechRecognition API not supported in this browser');
        setError('Speech API not supported');
      }

    } catch (error) {
      console.error('Error starting voice detection:', error);
      setError('Failed to start');
    } finally {
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

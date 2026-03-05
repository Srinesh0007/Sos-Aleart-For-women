import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Calculator from './components/Calculator';
import SOSDashboard from './components/SOSDashboard';
import ActiveSOS from './components/ActiveSOS';
import VoiceTrigger from './components/VoiceTrigger';
import MotionTrigger from './components/MotionTrigger';
import GuardianDashboard from './components/GuardianDashboard';
import TentDashboard from './components/TentDashboard';
import { AppConfig, SOSStatus, SOSState, Evidence } from './types';
import { Shield, AlertTriangle, Calculator as CalcIcon, Users } from 'lucide-react';

const MOCK_EVIDENCE: Evidence[] = [
  {
    id: '1',
    type: 'photo',
    timestamp: new Date(Date.now() - 3600000),
    url: 'https://picsum.photos/seed/evidence1/800/800',
  },
  {
    id: '2',
    type: 'audio',
    timestamp: new Date(Date.now() - 7200000),
    url: '#',
  },
  {
    id: '3',
    type: 'photo',
    timestamp: new Date(Date.now() - 86400000),
    url: 'https://picsum.photos/seed/evidence2/800/800',
  },
];

const DEFAULT_CONFIG: AppConfig = {
  fakeCalculatorCode: '911#',
  adminCode: '1234#',
  emergencyContacts: [
    { name: 'Emergency Contact', phone: '+1234567890', priority: 1 },
  ],
  deadManTimeout: 10,
  aiDetection: {
    voice: true,
    motion: true,
    customVoiceKeyword: 'help me',
  },
  evidence: {
    audio: true,
    camera: true,
    video: true,
  },
};

export default function App() {
  const [mode, setMode] = useState<'calculator' | 'dashboard' | 'sos' | 'guardian' | 'tent'>('calculator');
  const [config, setConfig] = useState<AppConfig>(() => {
    try {
      const saved = localStorage.getItem('stealthsos_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with DEFAULT_CONFIG to ensure new fields exist
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          aiDetection: {
            ...DEFAULT_CONFIG.aiDetection,
            ...(parsed.aiDetection || {})
          },
          evidence: {
            ...DEFAULT_CONFIG.evidence,
            ...(parsed.evidence || {})
          }
        };
      }
    } catch (e) {
      console.error("Failed to load config", e);
    }
    return DEFAULT_CONFIG;
  });

  // Save config to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('stealthsos_config', JSON.stringify(config));
  }, [config]);

  const [sosStatus, setSosStatus] = useState<SOSStatus>('idle');
  const [notificationStatus, setNotificationStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [isCooldown, setIsCooldown] = useState(false);
  const [remoteAlert, setRemoteAlert] = useState<{triggered: boolean, message?: string, location?: any} | null>(null);

  const fetchEvidence = useCallback(() => {
    fetch('/api/evidence')
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        // Ensure we handle the date objects correctly
        const formattedData = data.map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp)
        }));
        setEvidence(formattedData.sort((a: any, b: any) => b.timestamp.getTime() - a.timestamp.getTime()));
      })
      .catch(err => console.error("Failed to fetch evidence:", err));
  }, []);

  // Fetch evidence from server
  useEffect(() => {
    fetchEvidence();
  }, [fetchEvidence]);

  // Background Keep-Alive (Wake Lock & Silent Audio)
  useEffect(() => {
    let wakeLock: any = null;
    let audioCtx: AudioContext | null = null;
    let oscillator: OscillatorNode | null = null;

    const enableKeepAlive = async () => {
      // 1. Request Screen Wake Lock
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
          console.log('Wake Lock active: Screen will stay on.');
        }
      } catch (err) {
        console.log('Wake Lock failed or not supported:', err);
      }

      // 2. Silent Audio Loop (Hack to keep browser process active in background)
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass && !audioCtx) {
          audioCtx = new AudioContextClass();
          oscillator = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          
          // Make it completely silent
          gainNode.gain.value = 0.0001; // Almost zero to prevent optimization
          
          oscillator.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          oscillator.start();
          console.log('Silent audio loop started for background keep-alive.');
        }
      } catch (err) {
        console.log('Silent audio loop failed:', err);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        enableKeepAlive();
      }
    };

    // Require user interaction to start audio context
    const handleInteraction = () => {
      enableKeepAlive();
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
    };

    window.addEventListener('click', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (wakeLock) wakeLock.release().catch(() => {});
      if (oscillator) {
        try { oscillator.stop(); } catch (e) {}
      }
      if (audioCtx) {
        try { audioCtx.close(); } catch (e) {}
      }
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const [clientId] = useState(() => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  });

  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const [micStatus, setMicStatus] = useState<'active' | 'inactive' | 'error' | 'denied'>('inactive');
  const [lastMessage, setLastMessage] = useState<string>('');

  // WebSocket Connection for Real-time Alerts
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: any = null;
    let pingInterval: any = null;

    const connect = () => {
      setConnectionStatus('connecting');
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('Connected to SOS Network');
        setConnectionStatus('connected');
        // Keep alive
        pingInterval = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'PING' }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📩 WebSocket Message Received:', data.type, data);
          
          setLastMessage(JSON.stringify(data).slice(0, 50)); // Debug log
          
          // Handle SOS Alert
          if (data.type === 'SOS_ALERT') {
            if (data.triggered) {
              console.log('🚨 SOS ALERT BROADCAST RECEIVED!', {
                senderId: data.senderId,
                myClientId: clientId,
                isMatch: data.senderId === clientId
              });
              
              // Check if I am the sender
              if (data.senderId === clientId) {
                console.log('🚫 Ignoring own SOS alert');
                return;
              }

              triggerRemoteAlarm(data);
            }
            
            // Handle new evidence (for Guardian Dashboard)
            if (data.evidence) {
              setEvidence(prev => {
                const newEvidence = {
                  ...data.evidence,
                  timestamp: new Date(data.evidence.timestamp)
                };
                // Avoid duplicates
                if (prev.some(e => e.id === newEvidence.id)) return prev;
                return [newEvidence, ...prev];
              });
            }
          } else if (data.type === 'SOS_CANCELLED') {
             console.log('SOS CANCELLED BY SENDER', data);
             setRemoteAlert(null);
             // Optionally stop any playing alarm sound if we had a reference to it
             // But the current implementation plays for 5s fixed.
          }
        } catch (e) {
          console.error('Error parsing WS message', e);
        }
      };

      ws.onclose = () => {
        console.log('Disconnected from SOS Network, retrying...');
        setConnectionStatus('disconnected');
        if (pingInterval) clearInterval(pingInterval);
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws?.close();
      };
    };

    connect();

    return () => {
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingInterval) clearInterval(pingInterval);
    };
  }, [clientId]);

  const triggerRemoteAlarm = useCallback((data?: any) => {
    console.log('🔔 Triggering Remote Alarm UI...', data);
    
    // 1. Visual Alert
    setRemoteAlert({
      triggered: true,
      message: data?.message,
      location: data?.location
    });

    // Browser Notification
    try {
      if (Notification.permission === 'granted') {
        new Notification("EMERGENCY SOS ALERT", {
          body: data?.message || "Someone triggered an SOS!",
          icon: '/vite.svg'
        });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            new Notification("EMERGENCY SOS ALERT", {
              body: data?.message || "Someone triggered an SOS!"
            });
          }
        });
      }
    } catch (e) {
      console.error("Notification error:", e);
    }

    // 2. Audio Alarm (Siren)
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        
        // LFO for siren effect
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 1.5; // Siren cycle speed
        
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 400; // Frequency sweep range
        
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        lfo.start();

        gain.gain.value = 0.7; // Volume
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        
        // Play for 10 seconds or until dismissed (simplified to 10s for now)
        setTimeout(() => {
          try {
            osc.stop();
            lfo.stop();
            ctx.close();
          } catch (e) {}
        }, 10000);
      }
    } catch (e) {
      console.error("Failed to play alarm", e);
    }
  }, []);

  // Get location
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      });
    }
  }, []);

  const triggerSOS = useCallback(() => {
    if (navigator.vibrate) {
      navigator.vibrate(200); // Vibrate for 200ms
    }
    setSosStatus('dead-man-switch');
    setMode('sos');
    setNotificationStatus('sending');
    
    // Send notifications if location is available
    if (location && config.emergencyContacts.length > 0) {
      fetch('/api/sos/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contacts: config.emergencyContacts,
          location,
          message: 'StealthSOS User',
          senderId: clientId
        })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) setNotificationStatus('sent');
        else setNotificationStatus('failed');
      })
      .catch(err => {
        console.error("Failed to send SOS notifications:", err);
        setNotificationStatus('failed');
      });
    } else {
      setNotificationStatus('failed');
    }
  }, [location, config.emergencyContacts]);

  const triggerImmediateSOS = useCallback(() => {
    if (navigator.vibrate) {
      // Stronger vibration for immediate trigger
      navigator.vibrate([200, 100, 200]); 
    }
    setSosStatus('active');
    setMode('sos');
    setNotificationStatus('sending');

    // Send notifications immediately
    if (location && config.emergencyContacts.length > 0) {
      fetch('/api/sos/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contacts: config.emergencyContacts,
          location,
          message: 'StealthSOS User (IMMEDIATE TRIGGER)',
          senderId: clientId
        })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) setNotificationStatus('sent');
        else setNotificationStatus('failed');
      })
      .catch(err => {
        console.error("Failed to send SOS notifications:", err);
        setNotificationStatus('failed');
      });
    } else {
      setNotificationStatus('failed');
    }
  }, [location, config.emergencyContacts]);

  const handleCalculatorCode = (code: string) => {
    if (code === 'ADMIN' || code === config.adminCode) {
      fetchEvidence();
      setMode('dashboard');
    } else if (code === 'GUARDIAN' || code === '9999') {
      setMode('guardian');
    } else if (code === 'TENT' || code === '8368') {
      setMode('tent');
    }
  };

  const handleCancelSOS = (code: string) => {
    if (code === '1234') { // Default cancel code
      setSosStatus('idle');
      setMode('calculator');
      
      // Broadcast cancellation
      fetch('/api/sos/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId: clientId })
      }).catch(console.error);

      // Add a small delay before re-enabling voice/motion to allow cleanup
      setTimeout(() => {
        setIsCooldown(false);
      }, 1000);
    }
  };

  const handleSOSComplete = () => {
    setSosStatus('active');
  };

  const handleDeleteEvidence = async (id: string, url: string) => {
    // Remove hash fragments and query params before getting the filename
    const cleanUrl = url.split('#')[0].split('?')[0];
    const fileName = cleanUrl.split('/').pop();
    if (!fileName) return;

    try {
      const response = await fetch(`/api/evidence?file=${encodeURIComponent(fileName)}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (result.success) {
        fetchEvidence(); // Force sync with server
      } else {
        alert("Failed to delete evidence: " + (result.error || "Unknown error"));
      }
    } catch (error) {
      console.error("Error deleting evidence:", error);
      alert("Error deleting evidence. Please try again.");
    }
  };

  const handleDeleteAllEvidence = async () => {
    try {
      const response = await fetch('/api/evidence?all=true', {
        method: 'DELETE',
      });
      const result = await response.json();
      if (result.success) {
        setEvidence([]); // Clear local state immediately
        
        // Small delay before re-fetching to ensure filesystem sync is complete
        setTimeout(() => {
          fetchEvidence();
        }, 500);
      } else {
        alert("Failed to delete all evidence: " + (result.error || "Unknown error"));
      }
    } catch (error) {
      console.error("Error deleting all evidence:", error);
      alert("Error deleting all evidence. Please try again.");
    }
  };

  return (
    <div className="h-[100dvh] w-screen bg-black overflow-hidden font-sans">
      <VoiceTrigger 
        config={config} 
        onTrigger={triggerSOS} 
        onImmediateTrigger={triggerImmediateSOS}
        isActive={sosStatus === 'idle' && mode === 'calculator' && !isCooldown} 
        onStatusChange={setMicStatus}
      />
      <MotionTrigger 
        config={config} 
        onTrigger={triggerSOS} 
        isActive={sosStatus === 'idle' && mode === 'calculator' && !isCooldown} 
      />
      
      {/* Connection Status Indicator - REMOVED for stealth/clean look */}


      <AnimatePresence>
        {mode === 'calculator' && (
          <motion.div 
            key="calculator"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full"
          >
            <Calculator 
              onCodeEntered={handleCalculatorCode}
              onSOSTriggered={triggerSOS}
              config={config}
            />
          </motion.div>
        )}

        {mode === 'dashboard' && (
          <motion.div 
            key="dashboard"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="h-full"
          >
            <SOSDashboard 
              config={config}
              evidence={evidence}
              onUpdateConfig={setConfig}
              onDeleteEvidence={handleDeleteEvidence}
              onDeleteAllEvidence={handleDeleteAllEvidence}
              onClose={() => setMode('calculator')}
              onTestAlarm={() => triggerRemoteAlarm({ message: "TEST ALARM" })}
            />
          </motion.div>
        )}

        {mode === 'sos' && (
          <motion.div 
            key="sos"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full"
          >
            <ActiveSOS 
              status={sosStatus}
              config={config}
              notificationStatus={notificationStatus}
              onCancel={handleCancelSOS}
              onComplete={handleSOSComplete}
              onEvidenceCaptured={(newEvidence) => setEvidence(prev => [newEvidence, ...prev])}
            />
          </motion.div>
        )}

        {mode === 'guardian' && (
          <motion.div 
            key="guardian"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="h-full w-full absolute inset-0 z-50"
          >
            <GuardianDashboard onClose={() => setMode('calculator')} />
          </motion.div>
        )}

        {mode === 'tent' && (
          <motion.div 
            key="tent"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="h-full w-full absolute inset-0 z-50"
          >
            <TentDashboard 
              clientId={clientId} 
              onClose={() => setMode('calculator')} 
              onTriggerSOS={(msg) => {
                triggerImmediateSOS();
                // Optionally customize message
              }}
            />
          </motion.div>
        )}

        {remoteAlert && (
          <motion.div
            key="remote-sos-alert-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-red-600 flex items-center justify-center flex-col text-white p-8 text-center cursor-pointer"
            onClick={() => setRemoteAlert(null)}
          >
            <motion.div
              animate={{ scale: [1, 1.1, 1], opacity: [0.8, 1, 0.8] }}
              transition={{ duration: 0.8, repeat: Infinity }}
              className="flex flex-col items-center"
            >
              <AlertTriangle size={120} className="mb-8" />
              <h1 className="text-6xl font-black mb-4 tracking-tighter">SOS ALERT!</h1>
              <p className="text-3xl font-bold mb-4 bg-black/20 px-6 py-2 rounded-lg">
                {remoteAlert.message || "Emergency Triggered"}
              </p>
              {remoteAlert.location && (
                <div className="text-xl opacity-90 bg-white/10 p-4 rounded-xl backdrop-blur-sm">
                  <p className="font-mono">
                    LAT: {remoteAlert.location.lat.toFixed(6)}
                  </p>
                  <p className="font-mono">
                    LNG: {remoteAlert.location.lng.toFixed(6)}
                  </p>
                  <a 
                    href={`https://www.google.com/maps?q=${remoteAlert.location.lat},${remoteAlert.location.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-block bg-white text-red-600 px-6 py-2 rounded-full font-bold text-sm uppercase"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View on Maps
                  </a>
                </div>
              )}
            </motion.div>
            <p className="mt-12 text-xl opacity-60 border border-white/20 px-8 py-3 rounded-full uppercase tracking-widest font-bold">
              Tap anywhere to Dismiss
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

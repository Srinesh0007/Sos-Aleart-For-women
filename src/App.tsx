import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Calculator from './components/Calculator';
import SOSDashboard from './components/SOSDashboard';
import ActiveSOS from './components/ActiveSOS';
import VoiceTrigger from './components/VoiceTrigger';
import MotionTrigger from './components/MotionTrigger';
import { AppConfig, SOSStatus, SOSState, Evidence } from './types';
import { Shield, AlertTriangle, Calculator as CalcIcon } from 'lucide-react';

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
  const [mode, setMode] = useState<'calculator' | 'dashboard' | 'sos'>('calculator');
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

  const fetchEvidence = useCallback(() => {
    fetch('/api/evidence')
      .then(res => res.json())
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
          message: 'StealthSOS User'
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
          message: 'StealthSOS User (IMMEDIATE TRIGGER)'
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
    }
  };

  const handleCancelSOS = (code: string) => {
    if (code === '1234') { // Default cancel code
      setSosStatus('idle');
      setMode('calculator');
      // Removed the 10-second cooldown so the mic turns back on instantly
      setIsCooldown(false);
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
      />
      <MotionTrigger 
        config={config} 
        onTrigger={triggerSOS} 
        isActive={sosStatus === 'idle' && mode === 'calculator' && !isCooldown} 
      />
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
      </AnimatePresence>
    </div>
  );
}

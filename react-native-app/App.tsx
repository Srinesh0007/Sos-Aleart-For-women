import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, SafeAreaView, Vibration, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import Calculator from './components/Calculator';
import SOSDashboard from './components/SOSDashboard';
import ActiveSOS from './components/ActiveSOS';
import VoiceTrigger from './components/VoiceTrigger';

export default function App() {
  const [mode, setMode] = useState('calculator');
  const [sosStatus, setSosStatus] = useState('idle');
  const [location, setLocation] = useState(null);
  const [config, setConfig] = useState({
    fakeCalculatorCode: '911#',
    adminCode: '1234#',
    emergencyContacts: [
      { name: 'Emergency', phone: '911', priority: 1 }
    ],
    aiDetection: { voice: true, motion: true, customVoiceKeyword: 'help me' }
  });

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        let loc = await Location.getCurrentPositionAsync({});
        setLocation(loc.coords);
      }
    })();
  }, []);

  const triggerSOS = useCallback(() => {
    Vibration.vibrate(500);
    setSosStatus('dead-man-switch');
    setMode('sos');
  }, []);

  const triggerImmediateSOS = useCallback(() => {
    Vibration.vibrate([200, 100, 200]);
    setSosStatus('active');
    setMode('sos');
    sendAlerts();
  }, []);

  const sendAlerts = async () => {
    const isAvailable = await SMS.isAvailableAsync();
    if (isAvailable) {
      const { emergencyContacts } = config;
      const phones = emergencyContacts.map(c => c.phone);
      await SMS.sendSMSAsync(
        phones,
        `EMERGENCY SOS! My location: https://maps.google.com/?q=${location?.latitude},${location?.longitude}`
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {mode === 'calculator' && (
        <Calculator 
          onCodeEntered={(code) => {
            if (code === config.adminCode) setMode('dashboard');
          }}
          onSOSTriggered={triggerSOS}
          config={config}
        />
      )}
      {mode === 'dashboard' && (
        <SOSDashboard 
          config={config}
          onUpdateConfig={setConfig}
          onClose={() => setMode('calculator')}
        />
      )}
      {mode === 'sos' && (
        <ActiveSOS 
          status={sosStatus}
          onCancel={() => {
            setSosStatus('idle');
            setMode('calculator');
          }}
          onComplete={() => setSosStatus('active')}
        />
      )}
      <VoiceTrigger 
        isActive={sosStatus === 'idle' && mode === 'calculator'}
        keyword={config.aiDetection.customVoiceKeyword}
        onTrigger={triggerImmediateSOS}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});

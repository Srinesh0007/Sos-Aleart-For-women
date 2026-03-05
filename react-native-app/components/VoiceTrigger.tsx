import React, { useEffect, useRef } from 'react';
import { Audio } from 'expo-av';

export default function VoiceTrigger({ isActive, keyword, onTrigger }) {
  const recordingRef = useRef(null);

  useEffect(() => {
    if (isActive) {
      startMonitoring();
    } else {
      stopMonitoring();
    }
    return () => stopMonitoring();
  }, [isActive]);

  const startMonitoring = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.LOW_QUALITY
      );
      recordingRef.current = recording;

      // In a real app, you would use a library like `react-native-voice`
      // or stream this audio to a service for keyword spotting.
      // For this demo, we simulate detection via volume.
      recording.setOnRecordingStatusUpdate((status) => {
        if (status.metering > -12) { // Reduced sensitivity for mobile mic (was -20)
           onTrigger();
        }
      });
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  };

  const stopMonitoring = async () => {
    if (recordingRef.current) {
      await recordingRef.current.stopAndUnloadAsync();
      recordingRef.current = null;
    }
  };

  return null;
}

import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';

export default function ActiveSOS({ status, onCancel, onComplete }) {
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    if (status === 'dead-man-switch' && countdown > 0) {
      const timer = setInterval(() => setCountdown(c => c - 1), 1000);
      return () => clearInterval(timer);
    } else if (status === 'dead-man-switch' && countdown === 0) {
      onComplete();
    }
  }, [status, countdown]);

  return (
    <View style={styles.container}>
      <View style={styles.alertBox}>
        <Text style={styles.title}>
          {status === 'dead-man-switch' ? 'SOS TRIGGERED' : 'EMERGENCY ACTIVE'}
        </Text>
        
        {status === 'dead-man-switch' && (
          <Text style={styles.timer}>{countdown}</Text>
        )}

        <Text style={styles.desc}>
          {status === 'dead-man-switch' 
            ? 'Alerting contacts in ' + countdown + 's' 
            : 'Evidence is being recorded and sent to your contacts.'}
        </Text>

        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>CANCEL SOS</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', padding: 20 },
  alertBox: { width: '100%', backgroundColor: '#111', padding: 40, borderRadius: 30, alignItems: 'center', borderWidth: 2, borderColor: '#f44' },
  title: { color: '#f44', fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  timer: { color: '#fff', fontSize: 80, fontWeight: 'bold', marginBottom: 20 },
  desc: { color: '#666', textAlign: 'center', marginBottom: 40 },
  cancelBtn: { backgroundColor: '#f44', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 100 },
  cancelText: { color: '#fff', fontWeight: 'bold' },
});

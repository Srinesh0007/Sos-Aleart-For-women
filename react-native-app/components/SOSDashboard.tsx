import React from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Shield, Users, Bell, Camera, Settings } from 'lucide-react-native';

export default function SOSDashboard({ config, onUpdateConfig, onClose }) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>StealthSOS Admin</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeText}>Exit</Text>
        </TouchableOpacity>
      </View>
      
      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Emergency Contacts</Text>
          {config.emergencyContacts.map((c, i) => (
            <View key={i} style={styles.card}>
              <Text style={styles.cardText}>{c.name}</Text>
              <Text style={styles.cardSubtext}>{c.phone}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Triggers</Text>
          <View style={styles.card}>
            <Text style={styles.cardText}>Voice Keyword: {config.aiDetection.customVoiceKeyword}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardText}>Calculator Code: {config.fakeCalculatorCode}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#333' },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  closeBtn: { backgroundColor: '#333', padding: 10, borderRadius: 8 },
  closeText: { color: '#fff' },
  content: { padding: 20 },
  section: { marginBottom: 30 },
  sectionTitle: { color: '#666', fontSize: 12, fontWeight: 'bold', marginBottom: 10, textTransform: 'uppercase' },
  card: { backgroundColor: '#111', padding: 15, borderRadius: 12, marginBottom: 10, borderWeight: 1, borderColor: '#222' },
  cardText: { color: '#fff', fontSize: 16 },
  cardSubtext: { color: '#666', fontSize: 14 },
});

import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions } from 'react-native';

const { width } = Dimensions.get('window');
const BUTTON_SIZE = width / 4 - 15;

export default function Calculator({ onCodeEntered, onSOSTriggered, config }) {
  const [display, setDisplay] = useState('0');
  const [codeBuffer, setCodeBuffer] = useState('');

  const handlePress = (val) => {
    if (val === 'C') {
      setDisplay('0');
      setCodeBuffer('');
      return;
    }

    const newBuffer = codeBuffer + val;
    setCodeBuffer(newBuffer);
    setDisplay(display === '0' ? val : display + val);

    if (newBuffer.endsWith(config.fakeCalculatorCode)) {
      onSOSTriggered();
      setCodeBuffer('');
    } else if (newBuffer.endsWith(config.adminCode)) {
      onCodeEntered(config.adminCode);
      setCodeBuffer('');
    }
  };

  const buttons = [
    ['C', '±', '%', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '-'],
    ['1', '2', '3', '+'],
    ['0', '.', '=']
  ];

  return (
    <View style={styles.container}>
      <View style={styles.displayContainer}>
        <Text style={styles.displayText}>{display}</Text>
      </View>
      <View style={styles.grid}>
        {buttons.map((row, i) => (
          <View key={i} style={styles.row}>
            {row.map((btn) => (
              <TouchableOpacity 
                key={btn} 
                style={[styles.button, btn === '0' && { width: BUTTON_SIZE * 2 + 10 }]}
                onPress={() => handlePress(btn)}
              >
                <Text style={styles.buttonText}>{btn}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end', padding: 10 },
  displayContainer: { padding: 20, alignItems: 'flex-end' },
  displayText: { color: '#fff', fontSize: 80, fontWeight: '300' },
  grid: { gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center'
  },
  buttonText: { color: '#fff', fontSize: 30 },
});

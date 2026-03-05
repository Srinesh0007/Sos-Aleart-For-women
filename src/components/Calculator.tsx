import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Delete, Divide, Equal, Minus, Percent, Plus, X } from 'lucide-react';
import { AppConfig } from '../types';

interface CalculatorProps {
  onCodeEntered: (code: string) => void;
  onSOSTriggered: () => void;
  config: AppConfig;
}

export default function Calculator({ onCodeEntered, onSOSTriggered, config }: CalculatorProps) {
  const [display, setDisplay] = useState('0');
  const [prevValue, setPrevValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [inputSequence, setInputSequence] = useState('');

  const handleDigit = (digit: string) => {
    const newSequence = inputSequence + digit;
    setInputSequence(newSequence);

    if (waitingForOperand) {
      setDisplay(digit);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? digit : display + digit);
    }
  };

  const handleOperator = (nextOperator: string) => {
    const inputValue = parseFloat(display);

    if (prevValue === null) {
      setPrevValue(inputValue);
    } else if (operator) {
      const currentValue = prevValue || 0;
      const newValue = calculate(currentValue, inputValue, operator);
      setPrevValue(newValue);
      setDisplay(String(newValue));
    }

    setWaitingForOperand(true);
    setOperator(nextOperator);
    setInputSequence(inputSequence + nextOperator);
  };

  const calculate = (prev: number, current: number, op: string) => {
    switch (op) {
      case '+': return prev + current;
      case '-': return prev - current;
      case '*': return prev * current;
      case '/': return prev / current;
      default: return current;
    }
  };

  const handleEqual = () => {
    const inputValue = parseFloat(display);

    if (operator && prevValue !== null) {
      const newValue = calculate(prevValue, inputValue, operator);
      setDisplay(String(newValue));
      setPrevValue(null);
      setOperator(null);
      setWaitingForOperand(true);
    }

    // Check for SOS code
    if (inputSequence === config.fakeCalculatorCode) {
      onSOSTriggered();
    } else if (inputSequence.length > 0) {
      onCodeEntered(inputSequence);
    }
    setInputSequence('');
  };

  const handleClear = () => {
    setDisplay('0');
    setPrevValue(null);
    setOperator(null);
    setWaitingForOperand(false);
    setInputSequence('');
  };

  const handleSpecial = (key: string) => {
    if (key === '#') {
      const newSequence = inputSequence + '#';
      setInputSequence(newSequence);
      if (newSequence === config.fakeCalculatorCode) {
        onSOSTriggered();
        setInputSequence('');
      } else if (newSequence === config.adminCode) { // Admin code
        onCodeEntered('ADMIN');
        setInputSequence('');
      } else if (newSequence === '9999#') { // Guardian code
        onCodeEntered('GUARDIAN');
        setInputSequence('');
      } else if (newSequence === '8368#') { // Tent code
        onCodeEntered('TENT');
        setInputSequence('');
      }
    }
  };

  return (
    <div className="flex flex-col h-full max-w-md mx-auto bg-black text-white select-none">
      <div className="calculator-display-container">
        <AnimatePresence mode="wait">
          <motion.div 
            key={display}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="text-8xl font-extralight tracking-tighter overflow-hidden text-ellipsis whitespace-nowrap pr-2"
          >
            {display}
          </motion.div>
        </AnimatePresence>
        
        {/* Faint indicator for stealth code entry - only visible to the user who knows to look */}
        <div className="absolute top-8 left-6 flex items-center gap-2 opacity-10">
          <div className="flex gap-1">
            {inputSequence.split('').map((_, i) => (
              <div key={i} className="w-1 h-1 rounded-full bg-white/50" />
            ))}
          </div>
          {/* Subtle listening pulse */}
          <motion.div 
            animate={{ opacity: [0.2, 0.5, 0.2] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-1.5 h-1.5 rounded-full bg-emerald-500"
          />
        </div>
      </div>

      <div className="px-6 pb-12">
        <div className="grid grid-cols-4 gap-4">
          <button onClick={handleClear} className="calculator-btn calculator-btn-special text-lg">AC</button>
          <button onClick={() => {}} className="calculator-btn calculator-btn-special text-lg">+/-</button>
          <button onClick={() => {}} className="calculator-btn calculator-btn-special text-lg">%</button>
          <button onClick={() => handleOperator('/')} className="calculator-btn calculator-btn-op">
            <Divide size={28} strokeWidth={2.5} />
          </button>

          <button onClick={() => handleDigit('7')} className="calculator-btn calculator-btn-num">7</button>
          <button onClick={() => handleDigit('8')} className="calculator-btn calculator-btn-num">8</button>
          <button onClick={() => handleDigit('9')} className="calculator-btn calculator-btn-num">9</button>
          <button onClick={() => handleOperator('*')} className="calculator-btn calculator-btn-op">
            <X size={28} strokeWidth={2.5} />
          </button>

          <button onClick={() => handleDigit('4')} className="calculator-btn calculator-btn-num">4</button>
          <button onClick={() => handleDigit('5')} className="calculator-btn calculator-btn-num">5</button>
          <button onClick={() => handleDigit('6')} className="calculator-btn calculator-btn-num">6</button>
          <button onClick={() => handleOperator('-')} className="calculator-btn calculator-btn-op">
            <Minus size={28} strokeWidth={2.5} />
          </button>

          <button onClick={() => handleDigit('1')} className="calculator-btn calculator-btn-num">1</button>
          <button onClick={() => handleDigit('2')} className="calculator-btn calculator-btn-num">2</button>
          <button onClick={() => handleDigit('3')} className="calculator-btn calculator-btn-num">3</button>
          <button onClick={() => handleOperator('+')} className="calculator-btn calculator-btn-op">
            <Plus size={28} strokeWidth={2.5} />
          </button>

          <button 
            onClick={() => handleDigit('0')} 
            className="calculator-btn calculator-btn-num col-span-2 !w-auto !rounded-[32px] px-8 justify-start"
          >
            0
          </button>
          <button onClick={() => handleSpecial('#')} className="calculator-btn calculator-btn-num">#</button>
          <button onClick={handleEqual} className="calculator-btn calculator-btn-op">
            <Equal size={28} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

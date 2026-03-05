import React, { useEffect, useRef } from 'react';
import { AppConfig } from '../types';

interface MotionTriggerProps {
  config: AppConfig;
  onTrigger: () => void;
  isActive: boolean;
}

export default function MotionTrigger({ config, onTrigger, isActive }: MotionTriggerProps) {
  const lastUpdate = useRef<number>(0);
  const lastX = useRef<number>(0);
  const lastY = useRef<number>(0);
  const lastZ = useRef<number>(0);
  const shakeThreshold = 25; // Sensitivity for shake/impact
  const fallThreshold = 5; // Sensitivity for sudden drop

  const onTriggerRef = useRef(onTrigger);
  const isActiveRef = useRef(isActive);
  const configRef = useRef(config);

  useEffect(() => {
    onTriggerRef.current = onTrigger;
    isActiveRef.current = isActive;
    configRef.current = config;
  }, [onTrigger, isActive, config]);

  useEffect(() => {
    if (!isActive || !config.aiDetection.motion) return;

    const handleMotion = (event: DeviceMotionEvent) => {
      if (!isActiveRef.current || !configRef.current.aiDetection.motion) return;

      const acceleration = event.accelerationIncludingGravity;
      if (!acceleration) return;

      const curTime = Date.now();
      if ((curTime - lastUpdate.current) > 100) {
        const diffTime = curTime - lastUpdate.current;
        lastUpdate.current = curTime;

        const x = acceleration.x || 0;
        const y = acceleration.y || 0;
        const z = acceleration.z || 0;

        // Use absolute difference for each component to avoid cancellation
        const deltaX = Math.abs(x - lastX.current);
        const deltaY = Math.abs(y - lastY.current);
        const deltaZ = Math.abs(z - lastZ.current);

        // Calculate speed based on total change
        // Multiplier 10000 / diffTime (approx 100ms) -> * 100
        // So a change of 1 m/s^2 per component -> speed ~ 100
        const speed = (deltaX + deltaY + deltaZ) / diffTime * 10000;

        // Lowered threshold to 2000 for better responsiveness while avoiding walking triggers
        if (speed > 2000) {
          console.log('Motion Trigger: High impact detected', speed);
          onTriggerRef.current();
        }

        // Detect sudden free fall (acceleration drops near zero) followed by impact
        const totalAccel = Math.sqrt(x*x + y*y + z*z);
        if (totalAccel < fallThreshold && totalAccel > 0.1) {
           console.log('Motion Trigger: Potential fall detected', totalAccel);
           // If we detect free fall, we can be more sensitive to the subsequent impact
           // But for now, let's just trigger if it's a clear free fall for a sustained period (which is hard to detect with just one event)
           // Instead, let's rely on the impact.
        }

        lastX.current = x;
        lastY.current = y;
        lastZ.current = z;
      }
    };

    window.addEventListener('devicemotion', handleMotion);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [isActive, config.aiDetection.motion]);

  return null;
}

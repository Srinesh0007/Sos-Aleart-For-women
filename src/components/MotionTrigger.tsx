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

        const speed = Math.abs(x + y + z - lastX.current - lastY.current - lastZ.current) / diffTime * 10000;

        // Detect sudden impact or shake
        if (speed > shakeThreshold) {
          console.log('Motion Trigger: High impact detected', speed);
          onTriggerRef.current();
        }

        // Detect sudden free fall (acceleration drops near zero)
        const totalAccel = Math.sqrt(x*x + y*y + z*z);
        if (totalAccel < fallThreshold && totalAccel > 0.1) {
           console.log('Motion Trigger: Potential fall detected', totalAccel);
           // We might want a more sophisticated fall detection, but this is a start
           // For now, let's just use impact as the primary trigger to avoid false positives
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

import { useRef, useState, useEffect } from 'react';

export function useScrollLock(lockDurationMs = 3000) {
  const [isLocked, setIsLocked] = useState(false);
  const lockTimerRef = useRef<any | null>(null);

  const activateLock = () => {
    // Clear any existing timer to extend the lock duration
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
    }
    
    setIsLocked(true);
    
    // Set a timer to release the scroll lock after lockDurationMs
    lockTimerRef.current = setTimeout(() => {
      setIsLocked(false);
      lockTimerRef.current = null;
    }, lockDurationMs);
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (lockTimerRef.current) {
        clearTimeout(lockTimerRef.current);
      }
    };
  }, []);

  return {
    isLocked,
    activateLock,
  };
}

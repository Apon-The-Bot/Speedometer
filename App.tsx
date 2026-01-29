import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SpeedUnit, LocationState, TimeFormat } from './types.ts';
import { convertFromMS, getUnitMax, haversineDistance } from './utils/conversions.ts';
import { Speedometer } from './components/Speedometer.tsx';
import { StatsPanel } from './components/StatsPanel.tsx';
import { SettingsDrawer } from './components/SettingsDrawer.tsx';
import { Header } from './components/Header.tsx';
import { Compass } from './components/Compass.tsx';
import { MiniMap } from './components/MiniMap.tsx';
import { Maximize2, Minimize2, Settings, RefreshCcw, AlertTriangle, Map as MapIcon } from 'lucide-react';

export const App: React.FC = () => {
  // --- State ---
  const [speedMS, setSpeedMS] = useState<number>(0);
  const [unit, setUnit] = useState<SpeedUnit>(SpeedUnit.KMH);
  const [activeUnits, setActiveUnits] = useState<SpeedUnit[]>([SpeedUnit.KMH, SpeedUnit.MPH, SpeedUnit.MS]);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(TimeFormat.H12_SEC);
  const [maxSpeedMS, setMaxSpeedMS] = useState<number>(0);
  const [avgSpeedMS, setAvgSpeedMS] = useState<number>(0);
  const [heading, setHeading] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [currentPos, setCurrentPos] = useState<{lat: number | null, lng: number | null}>({lat: null, lng: null});
  const [speedLimit, setSpeedLimit] = useState<number>(100);
  const [isAlertActive, setIsAlertActive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Map & Navigation States ---
  const [showMap, setShowMap] = useState(true);
  const [destination, setDestination] = useState<{lat: number, lng: number} | null>(null);

  // --- Refs for Calculations ---
  const totalDistance = useRef(0);
  const totalTime = useRef(0);
  const lastLocation = useRef<LocationState | null>(null);
  const speedBuffer = useRef<number[]>([]);
  const alertPlayed = useRef(false);

  // --- Audio ---
  const audioCtx = useRef<AudioContext | null>(null);
  const playAlert = useCallback(() => {
    if (!audioCtx.current) {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioCtx.current = new AudioContextClass();
        }
    }
    if (audioCtx.current) {
      const osc = audioCtx.current.createOscillator();
      const gain = audioCtx.current.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, audioCtx.current.currentTime);
      gain.gain.setValueAtTime(0.1, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.current.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(audioCtx.current.destination);
      osc.start();
      osc.stop(audioCtx.current.currentTime + 0.5);
    }
  }, []);

  // --- Logic ---
  const handleLocationUpdate = useCallback((position: GeolocationPosition) => {
    const { latitude, longitude, speed, heading: gpsHeading, accuracy: gpsAccuracy } = position.coords;
    const timestamp = position.timestamp;

    setCurrentPos({ lat: latitude, lng: longitude });

    if (gpsAccuracy && gpsAccuracy > 60) {
      setAccuracy(gpsAccuracy);
      return;
    }

    let currentSpeed = (speed !== null && speed >= 0.3) ? speed : 0;
    
    if (lastLocation.current) {
        const distMeters = haversineDistance(
            lastLocation.current.lat!, 
            lastLocation.current.lng!, 
            latitude, 
            longitude
        );
        const timeDiffSeconds = (timestamp - lastLocation.current.timestamp) / 1000;

        if (timeDiffSeconds > 0) {
            const movementThreshold = Math.max(2, (gpsAccuracy || 5) * 0.25);
            const isSignificantMovement = distMeters > movementThreshold;

            if (isSignificantMovement) {
                totalDistance.current += distMeters;
                totalTime.current += timeDiffSeconds;
                setAvgSpeedMS(totalDistance.current / totalTime.current);
                
                if (speed === null || speed < 0.3) {
                    currentSpeed = distMeters / timeDiffSeconds;
                }
            } else if (speed === null || speed < 0.3) {
                currentSpeed = 0;
            }
        }
    }

    speedBuffer.current.push(currentSpeed);
    if (speedBuffer.current.length > 10) speedBuffer.current.shift();
    const smoothSpeed = speedBuffer.current.reduce((a, b) => a + b, 0) / speedBuffer.current.length;
    
    const finalDisplaySpeed = smoothSpeed < 0.1 ? 0 : smoothSpeed;

    setSpeedMS(finalDisplaySpeed);
    setAccuracy(gpsAccuracy);
    if (gpsHeading !== null) setHeading(gpsHeading);

    if (finalDisplaySpeed > maxSpeedMS) setMaxSpeedMS(finalDisplaySpeed);

    lastLocation.current = { lat: latitude, lng: longitude, accuracy: gpsAccuracy, heading: gpsHeading, timestamp };
  }, [maxSpeedMS]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      handleLocationUpdate,
      (err) => {
        console.error(err);
        setError("GPS Signal Lost or Permission Denied");
      },
      { 
        enableHighAccuracy: true, 
        timeout: 10000,
        maximumAge: 0 
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [handleLocationUpdate]);

  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      const anyEvent = e as any;
      if (anyEvent.webkitCompassHeading !== undefined && anyEvent.webkitCompassHeading !== null) {
        setHeading(anyEvent.webkitCompassHeading);
      } else if (e.alpha !== null) {
        setHeading(360 - e.alpha);
      }
    };
    window.addEventListener('deviceorientation', handleOrientation, true);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, []);

  useEffect(() => {
    const currentUnitSpeed = convertFromMS(speedMS, unit);
    if (currentUnitSpeed > speedLimit) {
      setIsAlertActive(true);
      if (!alertPlayed.current) {
        playAlert();
        alertPlayed.current = true;
      }
    } else {
      setIsAlertActive(false);
      alertPlayed.current = false;
    }
  }, [speedMS, speedLimit, unit, playAlert]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(e => console.error(e));
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const resetStats = () => {
    setMaxSpeedMS(0);
    setAvgSpeedMS(0);
    totalDistance.current = 0;
    totalTime.current = 0;
    speedBuffer.current = Array(10).fill(0);
    setSpeedMS(0);
  };

  const toggleUnitVisibility = (u: SpeedUnit) => {
    setActiveUnits(prev => {
      if (prev.includes(u)) {
        if (unit === u || prev.length === 1) return prev;
        return prev.filter(item => item !== u);
      } else {
        return [...prev, u];
      }
    });
  };

  return (
    <div className={`relative h-screen w-full flex flex-col items-center justify-between p-4 bg-black overflow-hidden transition-all duration-500 ${isAlertActive ? 'speed-alert-active' : ''}`}>
      
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-25">
         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-900/30 rounded-full blur-[150px]"></div>
      </div>

      <Header accuracy={accuracy} timeFormat={timeFormat} heading={heading || 0} />

      <main className="flex-1 w-full flex flex-col items-center justify-center space-y-4 z-10 overflow-y-auto pb-24 no-scrollbar">
        <div className="relative w-full max-w-[420px] aspect-square flex items-center justify-center flex-shrink-0">
            <Speedometer 
              speed={convertFromMS(speedMS, unit)} 
              unit={unit} 
              max={getUnitMax(unit)} 
              isAlert={isAlertActive} 
            />
            
            <div className="absolute top-[52%] -translate-y-1/2 right-2 flex flex-col items-center gap-6 z-30 pointer-events-none">
                <Compass heading={heading || 0} />
            </div>
        </div>

        <div className="w-full max-w-md grid grid-cols-2 gap-4 px-2 mt-2">
            <StatsPanel 
              label="MAX SPEED" 
              value={convertFromMS(maxSpeedMS, unit)} 
              unit={unit} 
              icon={<Maximize2 size={16} className="text-blue-400" />} 
            />
            <StatsPanel 
              label="AVG SPEED" 
              value={convertFromMS(avgSpeedMS, unit)} 
              unit={unit} 
              icon={<RefreshCcw size={16} className="text-green-400" />} 
            />
            
            {showMap && (
              <div className="col-span-2 glass-panel rounded-2xl p-4 h-48 relative overflow-hidden border-l-4 border-l-blue-500/50 transition-all animate-in fade-in zoom-in duration-300">
                  <div className="flex items-center justify-between mb-3 relative z-20">
                      <div className="flex items-center gap-2">
                          <MapIcon size={14} className="text-blue-400" />
                          <span className="text-[10px] font-bold text-gray-400 tracking-tighter uppercase">Live Route Tracking</span>
                      </div>
                      {destination && (
                          <div className="bg-blue-600/20 px-2 py-0.5 rounded-full border border-blue-500/30">
                              <span className="text-[8px] font-black text-blue-400 uppercase tracking-widest">Navigation Active</span>
                          </div>
                      )}
                  </div>
                  <div className="absolute inset-0 top-10 z-10">
                      <MiniMap 
                        lat={currentPos.lat} 
                        lng={currentPos.lng} 
                        heading={heading} 
                        speed={speedMS}
                        destination={destination}
                        circular={false} 
                      />
                  </div>
              </div>
            )}
        </div>
      </main>

      <footer className="w-full max-w-md glass-panel rounded-[32px] p-4 flex items-center justify-around z-50 mb-safe mx-2 border-white/5 absolute bottom-4">
        <button 
          onClick={() => setIsSettingsOpen(true)}
          className="p-3 bg-white/5 rounded-2xl active:scale-90 transition-transform hover:bg-white/10"
        >
          <Settings className="text-gray-300" size={24} />
        </button>

        <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/5 shadow-inner">
          {activeUnits.map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`px-5 py-2.5 text-[11px] font-black rounded-xl transition-all duration-300 ${unit === u ? 'bg-blue-600 text-white shadow-lg scale-105' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {u.toUpperCase()}
            </button>
          ))}
        </div>

        <button 
          onClick={toggleFullscreen}
          className="p-3 bg-white/5 rounded-2xl active:scale-90 transition-transform hover:bg-white/10"
        >
          {isFullscreen ? <Minimize2 className="text-gray-300" size={24} /> : <Maximize2 className="text-gray-300" size={24} />}
        </button>
      </footer>

      {error && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 glass-panel border-red-500/50 px-6 py-4 rounded-2xl flex items-center gap-3 animate-pulse z-50 shadow-2xl">
          <AlertTriangle className="text-red-500" />
          <span className="text-xs font-black uppercase tracking-widest">{error}</span>
        </div>
      )}

      <SettingsDrawer 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        speedLimit={speedLimit}
        setSpeedLimit={setSpeedLimit}
        unit={unit}
        activeUnits={activeUnits}
        toggleUnit={toggleUnitVisibility}
        timeFormat={timeFormat}
        setTimeFormat={setTimeFormat}
        resetStats={resetStats}
        showMap={showMap}
        setShowMap={setShowMap}
        destination={destination}
        setDestination={setDestination}
      />
    </div>
  );
};
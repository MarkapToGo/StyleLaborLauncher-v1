import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';

export function VHSBackground({ isPreview = false }: { isPreview?: boolean }) {
  const { settings } = useSettingsStore();
  const vhsNoLines = settings.vhsNoLines;

  // Simulate time for the clock
  const [time, setTime] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-black font-['Press_Start_2P'] vhs-container">
        {/* Import Font */}
        <style>{`
            @import url("https://fonts.googleapis.com/css?family=Press+Start+2P");
            
            .vhs-container {
                font-family: 'Press Start 2P', cursive;
            }

            .scanlines {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 30;
                opacity: 0.6;
                will-change: opacity;
                animation: opacity 6s linear infinite; /* 3s -> 6s */
            }
            .scanlines:before {
                content: "";
                position: absolute;
                left: 0;
                top: 0;
                right: 0;
                bottom: 0;
                pointer-events: none;
                background: linear-gradient(to bottom, transparent 50%, rgba(0, 0, 0, 0.5) 51%);
                background-size: 100% 4px;
                will-change: background, background-size;
                animation: scanlines 0.6s linear infinite; /* 0.2s -> 0.6s */
            }

            .intro-wrap {
                position: absolute;
                top: 0;
                left: 0;
                color: #fff;
                font-size: ${isPreview ? '0.5rem' : '2rem'};
                width: 100%;
                height: 100%;
                background: ${vhsNoLines ? '#000000' : '#242424'}; /* Black if no lines, Gray if lines */
            }

            .noise {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                overflow: hidden;
                z-index: 40;
                opacity: 0.8;
                pointer-events: none;
            }
            .noise:before {
                content: "";
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: url("https://ice-creme.de/images/background-noise.png");
                pointer-events: none;
                background-size: 200%;
            }
            
            .noise-moving {
                opacity: 1;
                z-index: 45;
            }
            .noise-moving:before {
                will-change: background-position;
                animation: noise 3s infinite alternate; /* 1s -> 3s */
            }

            .play {
                position: absolute;
                left: ${isPreview ? '0.5rem' : '2rem'};
                top: ${isPreview ? '0.5rem' : '2rem'};
                will-change: text-shadow;
                animation: rgbText 4s steps(9) 0s infinite alternate; /* 2s -> 4s */
                display: flex; /* For splitting chars */
            }
            .char {
                will-change: opacity;
                animation: type 3s infinite alternate; /* 1.2s -> 3s */
                animation-delay: calc(100ms * var(--char-index)); /* 60ms -> 100ms */
            }

            .time {
                position: absolute;
                right: ${isPreview ? '0.5rem' : '2rem'};
                top: ${isPreview ? '0.5rem' : '2rem'};
                will-change: text-shadow;
                animation: rgbText 3s steps(9) 0s infinite alternate; /* 1s -> 3s */
            }
            
            .recordSpeed {
                position: absolute;
                left: ${isPreview ? '0.5rem' : '2rem'};
                bottom: ${isPreview ? '0.5rem' : '2rem'};
                will-change: text-shadow;
                animation: rgbText 3s steps(9) 0s infinite alternate; /* 1s -> 3s */
            }

            @keyframes noise {
                0%, 100% { background-position: 0 0; }
                10% { background-position: -5% -10%; }
                20% { background-position: -15% 5%; }
                30% { background-position: 7% -25%; }
                40% { background-position: 20% 25%; }
                50% { background-position: -25% 10%; }
                60% { background-position: 15% 5%; }
                70% { background-position: 0 15%; }
                80% { background-position: 25% 35%; }
                90% { background-position: -10% 10%; }
            }
            @keyframes opacity {
                0% { opacity: 0.6; }
                20% { opacity: 0.3; }
                35% { opacity: 0.5; }
                50% { opacity: 0.8; }
                60% { opacity: 0.4; }
                80% { opacity: 0.7; }
                100% { opacity: 0.6; }
            }
            @keyframes scanlines {
                from {
                    background: linear-gradient(to bottom, transparent 50%, rgba(0, 0, 0, 0.5) 51%);
                    background-size: 100% 4px;
                }
                to {
                    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.5) 50%, transparent 51%);
                    background-size: 100% 4px;
                }
            }
            @keyframes rgbText {
                0%, 25% {
                    text-shadow: -1px 1px 8px rgba(255, 255, 255, 0.6), 1px -1px 8px rgba(255, 255, 235, 0.7), 0px 0 1px rgba(251, 0, 231, 0.8), 0 0px 3px rgba(0, 233, 235, 0.8), 0px 0 3px rgba(0, 242, 14, 0.8), 0 0px 3px rgba(244, 45, 0, 0.8), 0px 0 3px rgba(59, 0, 226, 0.8);
                }
                45% {
                    text-shadow: -1px 1px 8px rgba(255, 255, 255, 0.6), 1px -1px 8px rgba(255, 255, 235, 0.7), 5px 0 1px rgba(251, 0, 231, 0.8), 0 5px 1px rgba(0, 233, 235, 0.8), -5px 0 1px rgba(0, 242, 14, 0.8), 0 -5px 1px rgba(244, 45, 0, 0.8), 5px 0 1px rgba(59, 0, 226, 0.8);
                }
                50% {
                    text-shadow: -1px 1px 8px rgba(255, 255, 255, 0.6), 1px -1px 8px rgba(255, 255, 235, 0.7), -5px 0 1px rgba(251, 0, 231, 0.8), 0 -5px 1px rgba(0, 233, 235, 0.8), 5px 0 1px rgba(0, 242, 14, 0.8), 0 5px 1px rgba(244, 45, 0, 0.8), -5px 0 1px rgba(59, 0, 226, 0.8);
                }
                55% {
                    text-shadow: -1px 1px 8px rgba(255, 255, 255, 0.6), 1px -1px 8px rgba(255, 255, 235, 0.7), 0px 0 3px rgba(251, 0, 231, 0.8), 0 0px 3px rgba(0, 233, 235, 0.8), 0px 0 3px rgba(0, 242, 14, 0.8), 0 0px 3px rgba(244, 45, 0, 0.8), 0px 0 3px rgba(59, 0, 226, 0.8);
                }
                90% {
                    text-shadow: -1px 1px 8px rgba(255, 255, 255, 0.6), 1px -1px 8px rgba(255, 255, 235, 0.7), -5px 0 1px rgba(251, 0, 231, 0.8), 0 5px 1px rgba(0, 233, 235, 0.8), 5px 0 1px rgba(0, 242, 14, 0.8), 0 -5px 1px rgba(244, 45, 0, 0.8), 5px 0 1px rgba(59, 0, 226, 0.8);
                }
                100% {
                    text-shadow: -1px 1px 8px rgba(255, 255, 255, 0.6), 1px -1px 8px rgba(255, 255, 235, 0.7), 5px 0 1px rgba(251, 0, 231, 0.8), 0 -5px 1px rgba(0, 233, 235, 0.8), -5px 0 1px rgba(0, 242, 14, 0.8), 0 5px 1px rgba(244, 45, 0, 0.8), -5px 0 1px rgba(59, 0, 226, 0.8);
                }
            }
            @keyframes type {
                0%, 19% { opacity: 0; }
                20%, 100% { opacity: 1; }
            }
        `}</style>

        {!vhsNoLines && <div className="scanlines" />}

        <div className="intro-wrap">
            <div className="noise" />
            <div className="noise noise-moving" />

            <div className="play">
                {['L','A','U','N','C','H','E','R'].map((char, index) => (
                    <span 
                        key={index} 
                        className="char" 
                        style={{ '--char-index': index } as React.CSSProperties}
                    >
                        {char}
                    </span>
                ))}
            </div>
            <div className="time">{time || '--:--'}</div>
            <div className="recordSpeed">マーロン開発</div>
        </div>
    </div>
  );
}

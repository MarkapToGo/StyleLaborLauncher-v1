import { cn } from '../../lib/utils';

export function WavyBackground({ className }: { className?: string }) {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-bg-primary">
       <div className={cn("absolute inset-x-0 bottom-0 opacity-30", className || "h-[50vh]")}>
        <svg className="w-full h-full" viewBox="0 24 150 28" preserveAspectRatio="none" shapeRendering="auto">
            <defs>
                <path id="gentle-wave" d="M-160 44c30 0 58-18 88-18s 58 18 88 18 58-18 88-18 58 18 88 18 v44h-352z" />
            </defs>
            <g className="parallax">
                <use xlinkHref="#gentle-wave" x="48" y="0" fill="currentColor" className="text-accent opacity-70 animate-wave" style={{ animationDuration: '7s', animationDelay: '-2s' }} />
                <use xlinkHref="#gentle-wave" x="48" y="3" fill="currentColor" className="text-accent opacity-50 animate-wave" style={{ animationDuration: '10s', animationDelay: '-3s' }} />
                <use xlinkHref="#gentle-wave" x="48" y="5" fill="currentColor" className="text-accent opacity-30 animate-wave" style={{ animationDuration: '13s', animationDelay: '-4s' }} />
                <use xlinkHref="#gentle-wave" x="48" y="7" fill="currentColor" className="text-accent opacity-10 animate-wave" style={{ animationDuration: '20s', animationDelay: '-5s' }} />
            </g>
        </svg>
       </div>
       <style>{`
        .animate-wave {
            animation: wave 25s cubic-bezier(.55,.5,.45,.5) infinite;
        }
        @keyframes wave {
            0% { transform: translate3d(-90px,0,0); }
            100% { transform: translate3d(85px,0,0); }
        }
       `}</style>
       <div className="absolute inset-0 bg-gradient-to-t from-bg-primary via-transparent to-bg-primary/50" />
    </div>
  );
}

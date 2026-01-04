 

export function OctagonSquareBackground({ size = '120px' }: { size?: string }) {
    return (
        <div className="absolute inset-0 z-0 overflow-hidden bg-[#111]">
             {/* We use a specific div for the pattern to avoid polluting the global scope with @property if we can help it, 
                 though @property is global. We scope the styles to this component. */}
             <div 
                className="absolute inset-0 pattern-container opacity-40" 
                style={{ '--s': size } as React.CSSProperties}
             />
             
             <style>{`
                @property --a{
                  syntax: '<angle>';
                  inherits: true;
                  initial-value: 0deg;
                }
                @property --p {
                  syntax: '<percentage>';
                  inherits: true;
                  initial-value: 0%;
                }
                @property --c1 {
                  syntax: '<color>';
                  inherits: true;
                  initial-value: #000;
                }
                @property --c2 {
                  syntax: '<color>';
                  inherits: true;
                  initial-value: #000;
                }

                .pattern-container {
                  /* Size controlled by inline style */
                  /* Using dark theme colors instead of the bright demo colors for a background */
                  --c1-initial: #424242; 
                  --c2-initial: #141414;
                  
                  --_g: #0000, var(--c1) 2deg calc(var(--a) - 2deg),#0000 var(--a);
                  background: 
                    conic-gradient(from calc(-45deg  - var(--a)/2) at top    var(--p) left  var(--p),var(--_g)),
                    conic-gradient(from calc(-45deg  - var(--a)/2) at top    var(--p) left  var(--p),var(--_g)),
                    conic-gradient(from calc( 45deg  - var(--a)/2) at top    var(--p) right var(--p),var(--_g)),
                    conic-gradient(from calc( 45deg  - var(--a)/2) at top    var(--p) right var(--p),var(--_g)),
                    conic-gradient(from calc(-135deg - var(--a)/2) at bottom var(--p) left  var(--p),var(--_g)),
                    conic-gradient(from calc(-135deg - var(--a)/2) at bottom var(--p) left  var(--p),var(--_g)),
                    conic-gradient(from calc( 135deg - var(--a)/2) at bottom var(--p) right var(--p),var(--_g)),
                    conic-gradient(from calc( 135deg - var(--a)/2) at bottom var(--p) right var(--p),var(--_g))
                    var(--c2);
                  background-size: calc(2*var(--s)) calc(2*var(--s));
                  animation: m 3s infinite alternate linear;
                }

                @keyframes m {
                  0%,15% {
                    --a: 135deg;
                    --p: 20%;
                    --c1: var(--c1-initial);
                    --c2: var(--c2-initial);
                    background-position: 0 0,var(--s) var(--s);
                  }
                  45%,50% {
                    --a: 90deg;
                    --p: 25%;
                    --c1: var(--c1-initial);
                    --c2: var(--c2-initial);
                    background-position: 0 0,var(--s) var(--s);
                  }
                  50.01%,55% {
                    --a: 90deg;
                    --p: 25%;
                    --c2: var(--c1-initial);
                    --c1: var(--c2-initial);
                    background-position: var(--s) 0,0 var(--s);
                  }
                  85%,100% {
                    --a: 135deg;
                    --p: 20%;
                    --c2: var(--c1-initial);
                    --c1: var(--c2-initial);
                    background-position: var(--s) 0,0 var(--s);
                  }
                }
             `}</style>
             <div className="absolute inset-0 bg-gradient-to-t from-bg-primary via-bg-primary/50 to-bg-primary pointer-events-none" />
        </div>
    )
}


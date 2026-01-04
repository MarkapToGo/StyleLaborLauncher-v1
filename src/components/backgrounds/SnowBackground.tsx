import { useEffect, useRef } from 'react';

export function SnowBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const snowflakes: {x: number, y: number, r: number, d: number}[] = [];
    const maxSnowflakes = 100;

    const init = () => {
        const { width, height } = container.getBoundingClientRect();
        w = canvas.width = width;
        h = canvas.height = height;

        // Reset snowflakes if needed, or just let them be bound by new dimensions
        if (snowflakes.length === 0) {
             for (let i = 0; i < maxSnowflakes; i++) {
                snowflakes.push({
                    x: Math.random() * w,
                    y: Math.random() * h,
                    r: Math.random() * 2 + 0.5,
                    d: Math.random() * maxSnowflakes
                });
            }
        }
    };

    const drawSnowflakes = () => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        for (let i = 0; i < maxSnowflakes; i++) {
            const f = snowflakes[i];
            ctx.moveTo(f.x, f.y);
            ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2, true);
        }
        ctx.fill();
        moveSnowflakes();
    }

    let angle = 0;
    const moveSnowflakes = () => {
        angle += 0.005; // Slower sway
        for (let i = 0; i < maxSnowflakes; i++) {
            const f = snowflakes[i];
            
            // Much slower fall speed, significantly reduced horizontal sway
            f.y += Math.cos(angle + f.d) + 0.5 + (f.r * 0.2); 
            f.x += Math.sin(angle) * 0.3; // Reduced from 1 to 0.3

            // Reset when out of bottom view; spawn slightly above top
            if (f.y > h + 10) {
                snowflakes[i] = { 
                    x: Math.random() * w, 
                    y: -10, 
                    r: f.r, 
                    d: f.d 
                };
            }
            if (f.x > w + 10 || f.x < -10) {
                if (Math.sin(angle) > 0) f.x = -10;
                else f.x = w + 10;
            }
        }
    }

    let animationId: number;
    const loop = () => {
        drawSnowflakes();
        animationId = requestAnimationFrame(loop);
    }

    // Initial setup
    init();
    loop();

    // Observe resize
    const resizeObserver = new ResizeObserver(() => {
        init();
    });
    resizeObserver.observe(container);
    
    return () => {
        resizeObserver.disconnect();
        cancelAnimationFrame(animationId);
    }

  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 z-0 overflow-hidden bg-[#0d101b]">
        <canvas ref={canvasRef} className="absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg-primary via-transparent to-transparent" />
    </div>
  );
}

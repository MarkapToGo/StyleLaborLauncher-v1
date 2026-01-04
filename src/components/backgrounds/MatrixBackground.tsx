import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';

interface MatrixBackgroundProps {
  isPreview?: boolean;
}

export function MatrixBackground({ isPreview = false }: MatrixBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettingsStore();

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let frameCount = 0;

    // Use store accent color or fallback to purple
    const accentColor = settings.accentColor || '#a855f7';

    let columns = 0;
    let drops: number[] = [];
    const chars = 'アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズブヅプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨョロヲゴゾドボポヴッン0123456789';

    const init = () => {
      const { width, height } = container.getBoundingClientRect();
      canvas.width = width;
      canvas.height = height;

      columns = Math.floor(width / (isPreview ? 10 : 20)); // Denser columns in preview
      drops = new Array(columns).fill(1).map(() => Math.random() * -100);
    };

    const draw = () => {
      // Slower animation: update only every 4th frame for very slow/chill feel
      frameCount++;
      if (frameCount % (isPreview ? 2 : 4) !== 0) { // Faster in preview
        animationId = requestAnimationFrame(draw);
        return;
      }

      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = accentColor;
      ctx.font = isPreview ? '10px monospace' : '15px monospace';

      for (let i = 0; i < drops.length; i++) {
        const text = chars.charAt(Math.floor(Math.random() * chars.length));
        ctx.fillText(text, i * (isPreview ? 10 : 20), drops[i] * (isPreview ? 10 : 20));

        if (drops[i] * (isPreview ? 10 : 20) > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
      animationId = requestAnimationFrame(draw);
    };

    // Initial setup
    init();
    draw();

    // Observe resize
    const resizeObserver = new ResizeObserver(() => {
      init();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animationId);
    };
  }, [settings.accentColor, isPreview]);

  return (
    <div ref={containerRef} className="absolute inset-0 z-0 overflow-hidden bg-black">
      <canvas ref={canvasRef} className="absolute inset-0" />
      {!isPreview && (
        <div className="absolute inset-0 bg-gradient-to-t from-bg-primary via-bg-primary/40 to-transparent" />
      )}
    </div>
  );
}

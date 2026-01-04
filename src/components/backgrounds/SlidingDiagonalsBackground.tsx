export function SlidingDiagonalsBackground() {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-bg-primary">
      <div 
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 20px, #ffffff 20px, #ffffff 40px)',
          backgroundSize: '200% 200%',
          animation: 'sliding-background 20s linear infinite'
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-bg-primary via-transparent to-bg-primary" />
    </div>
  );
}

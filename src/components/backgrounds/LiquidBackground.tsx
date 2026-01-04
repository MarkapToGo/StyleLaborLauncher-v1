export function LiquidBackground() {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-[#111]">
      <svg className="hidden">
        <defs>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="15" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 25 -9" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop"/>
          </filter>
        </defs>
      </svg>
      
      <div className="w-full h-full" style={{ filter: 'url(#goo)' }}>
         {/* Animated blobs */}
         <div 
            className="absolute top-[20%] left-[20%] w-[400px] h-[400px] bg-blue-500 rounded-full animate-blob mix-blend-screen opacity-70"
            style={{ animationDelay: '0s' }}
         />
         <div 
            className="absolute top-[20%] right-[20%] w-[350px] h-[350px] bg-purple-500 rounded-full animate-blob mix-blend-screen opacity-70"
            style={{ animationDelay: '2s' }}
         />
         <div 
            className="absolute bottom-[20%] left-[30%] w-[450px] h-[450px] bg-indigo-500 rounded-full animate-blob mix-blend-screen opacity-70"
            style={{ animationDelay: '4s' }}
         />
         <div 
             className="absolute top-[40%] left-[45%] w-[200px] h-[200px] bg-pink-500 rounded-full animate-blob mix-blend-screen opacity-70"
             style={{ animationDelay: '6s' }}
         />
      </div>
      <div className="absolute inset-0 bg-bg-primary/20 backdrop-blur-[2px]" />
    </div>
  );
}

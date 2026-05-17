import React, { useEffect, useRef } from 'react';

interface Props {
  src: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function TransparentLogo({ src, className, style }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const img = new Image();
    img.src = src;
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        const luminance = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
        
        // Output perfectly transparent black based on luminance
        data[i] = 0;     // Red
        data[i+1] = 0;   // Green
        data[i+2] = 0;   // Blue
        data[i+3] = 255 - luminance; // Alpha
      }
      ctx.putImageData(imgData, 0, 0);
    };
  }, [src]);

  return <canvas ref={canvasRef} className={className} style={{ ...style, filter: 'var(--logo-filter)' }} />;
}

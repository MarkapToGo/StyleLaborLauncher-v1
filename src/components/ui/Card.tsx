import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '../../lib/utils';

interface CardProps extends HTMLMotionProps<'div'> {
  variant?: 'default' | 'glass' | 'elevated';
  hover?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({
  children,
  className,
  variant = 'default',
  hover = true,
  padding = 'md',
  ...props
}: CardProps) {
  const baseStyles = 'rounded-lg transition-all duration-200';
  
  const variants = {
    default: 'bg-bg-secondary border border-border',
    glass: 'glass',
    elevated: 'bg-bg-secondary border border-border shadow-card',
  };
  
  const paddings = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-5',
  };
  
  const hoverStyles = hover 
    ? 'hover:border-border-hover cursor-pointer' 
    : '';

  return (
    <motion.div
      className={cn(baseStyles, variants[variant], paddings[padding], hoverStyles, className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function CardHeader({ 
  children, 
  className 
}: { 
  children: React.ReactNode; 
  className?: string;
}) {
  return (
    <div className={cn('mb-3', className)}>
      {children}
    </div>
  );
}

export function CardTitle({ 
  children, 
  className 
}: { 
  children: React.ReactNode; 
  className?: string;
}) {
  return (
    <h3 className={cn('text-sm font-semibold text-white', className)}>
      {children}
    </h3>
  );
}

export function CardDescription({ 
  children, 
  className 
}: { 
  children: React.ReactNode; 
  className?: string;
}) {
  return (
    <p className={cn('text-xs text-text-secondary mt-0.5', className)}>
      {children}
    </p>
  );
}

export function CardContent({ 
  children, 
  className 
}: { 
  children: React.ReactNode; 
  className?: string;
}) {
  return (
    <div className={cn('', className)}>
      {children}
    </div>
  );
}

export function CardFooter({ 
  children, 
  className 
}: { 
  children: React.ReactNode; 
  className?: string;
}) {
  return (
    <div className={cn('mt-3 pt-3 border-t border-border flex items-center gap-2', className)}>
      {children}
    </div>
  );
}

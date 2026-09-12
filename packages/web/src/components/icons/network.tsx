import type { Variants } from 'motion/react';
import { motion, useAnimation } from 'motion/react';
import type { HTMLAttributes } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { cn } from '@/lib/utils';

export interface NetworkIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface NetworkIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const CIRCLE_VARIANTS: Variants = {
  normal: { scale: 1, originX: '50%', originY: '50%' },
  animate: {
    scale: [1, 1.2, 1],
    originX: '50%',
    originY: '50%',
    transition: { duration: 0.4, ease: 'easeInOut' },
  },
};

const LINE_VARIANTS: Variants = {
  normal: { opacity: 1 },
  animate: {
    opacity: [1, 0.4, 1],
    transition: { duration: 0.4, ease: 'easeInOut' },
  },
};

const NetworkIcon = forwardRef<NetworkIconHandle, NetworkIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 16, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: () => controls.start('animate'),
        stopAnimation: () => controls.start('normal'),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start('animate');
        }
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start('normal');
        }
      },
      [controls, onMouseLeave],
    );

    return (
      <div
        className={cn(className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        <svg
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <motion.line
            animate={controls}
            variants={LINE_VARIANTS}
            x1="12"
            y1="5"
            x2="5"
            y2="19"
          />
          <motion.line
            animate={controls}
            variants={LINE_VARIANTS}
            x1="12"
            y1="5"
            x2="19"
            y2="19"
          />
          <motion.line
            animate={controls}
            variants={LINE_VARIANTS}
            x1="5"
            y1="19"
            x2="19"
            y2="19"
          />
          <motion.circle
            animate={controls}
            variants={CIRCLE_VARIANTS}
            cx="12"
            cy="5"
            r="2.5"
          />
          <motion.circle
            animate={controls}
            variants={CIRCLE_VARIANTS}
            cx="5"
            cy="19"
            r="2.5"
          />
          <motion.circle
            animate={controls}
            variants={CIRCLE_VARIANTS}
            cx="19"
            cy="19"
            r="2.5"
          />
        </svg>
      </div>
    );
  },
);

NetworkIcon.displayName = 'NetworkIcon';

export { NetworkIcon };

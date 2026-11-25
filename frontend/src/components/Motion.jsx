import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { EASE_EDITORIAL } from "./motionTokens";

export function PageReveal({ children, className = "" }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: EASE_EDITORIAL }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerContainer({ children, className = "", stagger = 0.045 }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: stagger,
          },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className = "", onClick, role, tabIndex, onKeyDown }) {
  return (
    <motion.div
      className={className}
      onClick={onClick}
      role={role}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.3, ease: EASE_EDITORIAL },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

export function FadePanel({ children, panelKey, className = "" }) {
  return (
    <motion.div
      key={panelKey}
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: EASE_EDITORIAL }}
    >
      {children}
    </motion.div>
  );
}

export function ExpandableSection({ children, className = "" }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.24, ease: EASE_EDITORIAL }}
      style={{ overflow: "hidden" }}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedNumber({ value = 0, duration = 420 }) {
  const numeric = Number(value) || 0;
  const [display, setDisplay] = useState(numeric);

  useEffect(() => {
    if (numeric === 0) return undefined;
    let frameId = 0;
    const start = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(numeric * eased));
      if (progress < 1) {
        frameId = requestAnimationFrame(step);
      }
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [numeric, duration]);

  return <>{(numeric === 0 ? 0 : display).toLocaleString()}</>;
}

import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "../context/ThemeContext";
import { MoonIcon, SunIcon } from "./Icons";
import { EASE_EDITORIAL } from "./motionTokens";

export default function ThemeToggle({ showLabel = false, className = "" }) {
  const { isDark, toggleTheme } = useTheme();
  const label = isDark ? "Switch to Parchment Light theme" : "Switch to Charcoal Dark theme";

  return (
    <button
      type="button"
      className={`theme-toggle-btn ${showLabel ? "theme-toggle-labeled" : ""} ${className}`.trim()}
      onClick={toggleTheme}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        <AnimatePresence mode="wait" initial={false}>
          {isDark ? (
            <motion.span
              key="sun"
              className="theme-icon-glyph"
              initial={{ opacity: 0, rotate: -45, scale: 0.78 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 45, scale: 0.78 }}
              transition={{ duration: 0.16, ease: EASE_EDITORIAL }}
            >
              <SunIcon size={15} />
            </motion.span>
          ) : (
            <motion.span
              key="moon"
              className="theme-icon-glyph"
              initial={{ opacity: 0, rotate: 45, scale: 0.78 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: -45, scale: 0.78 }}
              transition={{ duration: 0.16, ease: EASE_EDITORIAL }}
            >
              <MoonIcon size={15} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      {showLabel && (
        <span className="theme-toggle-text">{isDark ? "Parchment Light" : "Charcoal Dark"}</span>
      )}
    </button>
  );
}

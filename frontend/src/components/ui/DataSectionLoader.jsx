import React from 'react';
import { motion } from 'framer-motion';
import { Activity, Waves, Flame, Mountain, MapPinned } from 'lucide-react';

const iconByVariant = {
  nearby: MapPinned,
  flood: Waves,
  quake: Mountain,
  heatwave: Flame,
  timeline: Activity,
  default: Activity,
};

const themeByVariant = {
  nearby: 'from-cyan-500 to-blue-500',
  flood: 'from-blue-500 to-indigo-500',
  quake: 'from-orange-500 to-amber-500',
  heatwave: 'from-rose-500 to-orange-500',
  timeline: 'from-emerald-500 to-cyan-500',
  default: 'from-cyan-500 to-emerald-500',
};

const DataSectionLoader = ({
  title = 'Loading live data...',
  subtitle = 'Syncing latest observations',
  variant = 'default',
}) => {
  const Icon = iconByVariant[variant] || iconByVariant.default;
  const gradient = themeByVariant[variant] || themeByVariant.default;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card/80 backdrop-blur p-8">
      <div className="absolute -top-10 -right-8 h-28 w-28 rounded-full bg-primary/10 blur-2xl" />
      <div className="absolute -bottom-10 -left-8 h-32 w-32 rounded-full bg-secondary/10 blur-2xl" />

      <div className="relative z-10 flex flex-col items-center text-center">
        <motion.div
          animate={{ rotate: [0, 6, -6, 0], y: [0, -3, 0] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
          className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${gradient} text-white shadow-lg flex items-center justify-center`}
        >
          <Icon className="h-7 w-7" />
        </motion.div>

        <h4 className="mt-4 text-lg font-semibold text-foreground">{title}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

        <div className="mt-5 w-full max-w-xs h-2 rounded-full bg-muted overflow-hidden">
          <motion.div
            className={`h-full bg-gradient-to-r ${gradient}`}
            animate={{ x: ['-100%', '100%'] }}
            transition={{ repeat: Infinity, duration: 1.3, ease: 'linear' }}
          />
        </div>

        <div className="mt-4 flex gap-2">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-2 w-2 rounded-full bg-primary/70"
              animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
              transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default DataSectionLoader;

import React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, RadioTower } from 'lucide-react';

const ringTransition = {
  repeat: Infinity,
  duration: 2.2,
  ease: 'easeInOut',
};

const pulseTransition = {
  repeat: Infinity,
  duration: 1.8,
  ease: 'easeInOut',
};

const AppLoadingScreen = ({
  title = 'Syncing Safety Network',
  subtitle = 'Preparing alerts, maps, and AI guidance...',
}) => {
  return (
    <div className="min-h-screen relative overflow-hidden bg-slate-950 text-slate-100 flex items-center justify-center px-6">
      <div className="absolute inset-0 opacity-60">
        <div className="absolute -top-20 -left-10 w-72 h-72 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute top-1/3 -right-16 w-80 h-80 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 w-96 h-96 rounded-full bg-blue-500/20 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-xl bg-cyan-400/20 border border-cyan-300/40 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-cyan-200" />
            </div>
            <div>
              <p className="text-sm text-cyan-100/90 font-semibold">Suraksha Setu</p>
              <p className="text-xs text-slate-300">Emergency Intelligence Grid</p>
            </div>
          </div>

          <div className="relative mx-auto mb-6 h-28 w-28 flex items-center justify-center">
            <motion.div
              className="absolute h-28 w-28 rounded-full border border-cyan-300/40"
              animate={{ scale: [0.82, 1.05, 0.82], opacity: [0.45, 1, 0.45] }}
              transition={ringTransition}
            />
            <motion.div
              className="absolute h-20 w-20 rounded-full border border-emerald-300/50"
              animate={{ scale: [1.1, 0.9, 1.1], opacity: [0.35, 0.9, 0.35] }}
              transition={{ ...ringTransition, duration: 1.7 }}
            />
            <motion.div
              className="h-12 w-12 rounded-2xl bg-gradient-to-br from-cyan-300 to-emerald-300 text-slate-900 flex items-center justify-center shadow-lg"
              animate={{ y: [0, -3, 0], rotate: [0, 3, 0] }}
              transition={pulseTransition}
            >
              <RadioTower className="h-6 w-6" />
            </motion.div>
          </div>

          <h1 className="text-xl font-bold tracking-tight text-white text-center">{title}</h1>
          <p className="text-sm text-slate-300 text-center mt-2">{subtitle}</p>

          <div className="mt-6 h-2 rounded-full bg-slate-800 overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-cyan-300 via-blue-300 to-emerald-300"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ repeat: Infinity, duration: 1.6, ease: 'linear' }}
            />
          </div>

          <p className="text-[11px] text-slate-400 mt-4 text-center">Optimizing route intelligence and hazard feeds</p>
        </div>
      </div>
    </div>
  );
};

export default AppLoadingScreen;

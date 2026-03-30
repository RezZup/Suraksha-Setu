import React, { useState } from 'react';
import EnhancedAIChatInterface from '@/components/dashboard/EnhancedAIChatInterface';
import SurakshaScore from '@/components/dashboard/SurakshaScore';
import ActiveAlerts from '@/components/dashboard/ActiveAlerts';
import DisasterTimeline from '@/components/dashboard/DisasterTimeline';
import ImpactStats from '@/components/dashboard/ImpactStats';
import LiveAQIChart from '@/components/dashboard/LiveAQIChart';
import LocationSelector from '@/components/location/LocationSelector';
import NotificationSettings from '@/components/notifications/NotificationSettings';
import { Button } from "@/components/ui/button";
import { Download, Share2, RefreshCw, TrendingUp, ShieldCheck, BellRing, Clock3 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const Dashboard = () => {
  const { t } = useTranslation();
  const [score, setScore] = useState(82);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(new Date());

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setLastRefreshAt(new Date());
      setIsRefreshing(false);
    }, 900);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4">
      {/* Header Section with Better Gradient */}
      <motion.div
        className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-6 rounded-2xl border-2 border-indigo-100 dark:border-gray-800 shadow-lg backdrop-blur-sm"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <div className="space-y-2">
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
            {t('dashboard.commandCenter')}
          </h1>
          <p className="text-muted-foreground flex items-center gap-2 text-sm flex-wrap">
            <TrendingUp className="w-4 h-4" />
            {t('dashboard.commandSubtitle')}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-xs font-medium">
              <ShieldCheck className="w-3 h-3" /> System Live
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="hover:scale-105 transition-transform shadow-sm border-2"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {t('dashboard.refresh')}
          </Button>
          <Button variant="outline" size="sm" className="hover:scale-105 transition-transform shadow-sm border-2">
            <Share2 className="w-4 h-4 mr-2" />
            {t('dashboard.share')}
          </Button>
          <Button size="sm" className="hover:scale-105 transition-transform shadow-md bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-700 hover:via-purple-700 hover:to-pink-700">
            <Download className="w-4 h-4 mr-2" />
            {t('dashboard.export')}
          </Button>
        </div>
      </motion.div>

      {/* Enhanced AI Chat Interface - Full Width with Modern Design */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <EnhancedAIChatInterface />
      </motion.div>

      {/* Top Row: Score and Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[
          { Component: SurakshaScore, props: { score }, delay: 0.3 },
          { Component: ActiveAlerts, props: {}, delay: 0.35 },
        ].map(({ Component, props, delay }, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.4, delay }}
          >
            <Component {...props} />
          </motion.div>
        ))}
      </div>

      {/* Middle Row: Stats */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.45 }}
      >
        <ImpactStats />
      </motion.div>

      {/* Bottom Row: Timeline, AQI, Location & Recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div
          className="lg:col-span-2 space-y-6"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <DisasterTimeline />
          <LiveAQIChart />
        </motion.div>
        <motion.div
          className="space-y-6"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.55 }}
        >
          {/* Location Selector */}
          <LocationSelector />

          {/* Push Notifications */}
          <NotificationSettings />

          {/* Operations Panel */}
          <div className="bg-gradient-to-br from-slate-50 via-indigo-50 to-cyan-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 border-2 border-indigo-100 dark:border-gray-700 rounded-2xl p-6 shadow-lg backdrop-blur-sm">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2 text-foreground">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              Operations Panel
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/70 dark:bg-gray-800/80 border border-indigo-100 dark:border-gray-700">
                <span className="text-sm text-muted-foreground">Readiness Score</span>
                <span className="font-semibold text-indigo-700 dark:text-indigo-300">{score}/100</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/70 dark:bg-gray-800/80 border border-indigo-100 dark:border-gray-700">
                <span className="text-sm text-muted-foreground inline-flex items-center gap-2"><BellRing className="w-4 h-4" /> Alerts Channel</span>
                <span className="font-semibold text-emerald-600">Active</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/70 dark:bg-gray-800/80 border border-indigo-100 dark:border-gray-700">
                <span className="text-sm text-muted-foreground inline-flex items-center gap-2"><Clock3 className="w-4 h-4" /> Last Refresh</span>
                <span className="font-semibold text-foreground text-sm">{lastRefreshAt.toLocaleTimeString()}</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Dashboard;

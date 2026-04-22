import React, { useEffect, useState } from 'react';
import EnhancedAIChatInterface from '@/components/dashboard/EnhancedAIChatInterface';
import SurakshaScore from '@/components/dashboard/SurakshaScore';
import ActiveAlerts from '@/components/dashboard/ActiveAlerts';
import DisasterTimeline from '@/components/dashboard/DisasterTimeline';
import ImpactStats from '@/components/dashboard/ImpactStats';
import LiveAQIChart from '@/components/dashboard/LiveAQIChart';
import LocationSelector from '@/components/location/LocationSelector';
import NotificationSettings from '@/components/notifications/NotificationSettings';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, Share2, RefreshCw, TrendingUp, ShieldCheck, BellRing, Clock3 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const Dashboard = () => {
  const { t } = useTranslation();
  const score = 82;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(new Date());
  const [pageBooting, setPageBooting] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setPageBooting(false), 650);
    return () => clearTimeout(timer);
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setLastRefreshAt(new Date());
      setIsRefreshing(false);
    }, 900);
  };

  if (pageBooting) {
    return (
      <div className="space-y-5 max-w-[1600px] mx-auto px-2 md:px-4 pb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 2xl:grid-cols-12 gap-5">
          <Skeleton className="2xl:col-span-8 h-[420px] rounded-2xl" />
          <div className="2xl:col-span-4 space-y-5">
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
            <Skeleton className="h-56 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto px-2 md:px-4 pb-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>{t('dashboard.liveOverview')}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="hover:scale-105 transition-transform shadow-sm border"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {t('dashboard.refresh')}
          </Button>
          <Button variant="outline" size="sm" className="hover:scale-105 transition-transform shadow-sm border">
            <Share2 className="w-4 h-4 mr-2" />
            {t('dashboard.share')}
          </Button>
          <Button size="sm" className="hover:scale-105 transition-transform shadow-md bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-700 hover:via-purple-700 hover:to-pink-700">
            <Download className="w-4 h-4 mr-2" />
            {t('dashboard.export')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> {t('dashboard.system')}</p>
          <p className="text-sm font-semibold mt-1">{t('dashboard.operational')}</p>
        </div>
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5 text-indigo-600" /> {t('dashboard.scoreLabel')}</p>
          <p className="text-sm font-semibold mt-1">{score}/100</p>
        </div>
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><BellRing className="w-3.5 h-3.5 text-orange-500" /> {t('dashboard.alertFeed')}</p>
          <p className="text-sm font-semibold mt-1">{t('dashboard.liveUpdates')}</p>
        </div>
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock3 className="w-3.5 h-3.5 text-cyan-600" /> {t('dashboard.lastRefresh')}</p>
          <p className="text-sm font-semibold mt-1">{lastRefreshAt.toLocaleTimeString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-12 gap-5 items-start">
        <motion.div
          className="2xl:col-span-8 space-y-5"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <EnhancedAIChatInterface />
          <ImpactStats />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <DisasterTimeline />
            <LiveAQIChart />
          </div>
        </motion.div>

        <motion.div
          className="2xl:col-span-4 space-y-5"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.25 }}
        >
          <div className="bg-gradient-to-br from-slate-50 via-indigo-50 to-cyan-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 border-2 border-indigo-100 dark:border-gray-700 rounded-2xl p-6 shadow-lg backdrop-blur-sm">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2 text-foreground">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              {t('dashboard.operationsPanel')}
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/70 dark:bg-gray-800/80 border border-indigo-100 dark:border-gray-700">
                <span className="text-sm text-muted-foreground">{t('dashboard.readinessScore')}</span>
                <span className="font-semibold text-indigo-700 dark:text-indigo-300">{score}/100</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/70 dark:bg-gray-800/80 border border-indigo-100 dark:border-gray-700">
                <span className="text-sm text-muted-foreground inline-flex items-center gap-2"><BellRing className="w-4 h-4" /> {t('dashboard.alertsChannel')}</span>
                <span className="font-semibold text-emerald-600">{t('dashboard.active')}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/70 dark:bg-gray-800/80 border border-indigo-100 dark:border-gray-700">
                <span className="text-sm text-muted-foreground inline-flex items-center gap-2"><Clock3 className="w-4 h-4" /> {t('dashboard.lastRefresh')}</span>
                <span className="font-semibold text-foreground text-sm">{lastRefreshAt.toLocaleTimeString()}</span>
              </div>
            </div>
          </div>

          <SurakshaScore score={score} />
          <ActiveAlerts />
          <LocationSelector />
          <NotificationSettings />
        </motion.div>
      </div>
    </div>
  );
};

export default Dashboard;

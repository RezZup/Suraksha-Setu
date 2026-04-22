import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Brain,
  CloudRain,
  Flame,
  Hospital,
  LocateFixed,
  MapPin,
  RefreshCw,
  Shield,
  Siren,
  ThermometerSun,
  Trophy,
  Waves,
  Wind
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import Quiz from '@/components/student/Quiz';
import StudentChat from '@/components/student/StudentChat';
import { useLocation } from '@/contexts/LocationContext';

const API_BASE_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const CHECKLIST_STORAGE_KEY = 'student_safety_checklist_v2';
const QUIZ_PROGRESS_STORAGE_KEY = 'student_quiz_progress_v2';

const QUIZ_CATEGORIES = [
  {
    id: 'earthquake',
    title: 'Earthquake Safety',
    description: 'Drop, cover, hold, and plan reunification in advance.',
    icon: '🌍',
    color: 'from-red-500 to-orange-500',
    difficulty: 'Medium',
    questions: 5,
  },
  {
    id: 'flood',
    title: 'Flood Preparedness',
    description: 'Learn evacuation timing and safe movement in water.',
    icon: '🌊',
    color: 'from-sky-500 to-cyan-500',
    difficulty: 'Easy',
    questions: 5,
  },
  {
    id: 'cyclone',
    title: 'Cyclone Readiness',
    description: 'Prepare shelter plans, emergency kits, and communication trees.',
    icon: '🌀',
    color: 'from-indigo-500 to-blue-600',
    difficulty: 'Medium',
    questions: 5,
  },
  {
    id: 'fire',
    title: 'Fire Safety',
    description: 'Build safe habits for prevention and fast evacuation.',
    icon: '🔥',
    color: 'from-amber-500 to-red-600',
    difficulty: 'Easy',
    questions: 5,
  },
];

const LEARNING_TRACKS = [
  {
    id: 'kit',
    title: 'Emergency Kit Builder',
    duration: '12 min',
    description: 'Assemble essentials and prepare a 72-hour survival checklist.',
  },
  {
    id: 'evacuation',
    title: 'Family Evacuation Drill',
    duration: '18 min',
    description: 'Design safe routes and assign roles for every family member.',
  },
  {
    id: 'warning-signals',
    title: 'Early Warning Signals',
    duration: '10 min',
    description: 'Understand alert levels and choose the right response quickly.',
  },
];

const CHECKLIST_ITEMS = [
  { id: 'contacts', label: 'Saved emergency contacts in phone and notebook' },
  { id: 'go-bag', label: 'Prepared a grab-and-go emergency bag' },
  { id: 'routes', label: 'Reviewed two evacuation routes from home' },
  { id: 'meeting', label: 'Set a family meeting point and backup plan' },
  { id: 'alerts', label: 'Enabled phone notifications and app alerts' },
];

const readLocalJSON = (key, fallback) => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
};

const toDisplayNumber = (value, suffix = '') => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--';
  }
  return `${Math.round(value)}${suffix}`;
};

const StudentPortal = () => {
  const {
    location,
    alerts,
    loading: locationLoading,
    detectLocation,
    refreshNearbyAlerts,
    wsConnected,
  } = useLocation();

  const [activeTab, setActiveTab] = useState('overview');
  const [activeQuiz, setActiveQuiz] = useState(null);

  const [weatherSnapshot, setWeatherSnapshot] = useState(null);
  const [aqiSnapshot, setAqiSnapshot] = useState(null);
  const [disasterFeed, setDisasterFeed] = useState([]);
  const [nearbyServices, setNearbyServices] = useState([]);
  const [liveDataLoading, setLiveDataLoading] = useState(false);
  const [liveDataError, setLiveDataError] = useState('');

  const [checklistState, setChecklistState] = useState(() =>
    readLocalJSON(CHECKLIST_STORAGE_KEY, {})
  );
  const [quizProgress, setQuizProgress] = useState(() =>
    readLocalJSON(QUIZ_PROGRESS_STORAGE_KEY, {
      attempts: 0,
      bestScores: {},
      completedCategories: {},
      totalTimeSeconds: 0,
      lastCompletedAt: null,
    })
  );

  const latitude = location?.latitude ?? location?.lat;
  const longitude = location?.longitude ?? location?.lon;
  const hasCoordinates = Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));

  const fetchJson = useCallback(async (path) => {
    const response = await fetch(`${API_BASE_URL}${path}`);
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
  }, []);

  const refreshStudentData = useCallback(async () => {
    setLiveDataLoading(true);
    setLiveDataError('');

    const lat = Number(latitude);
    const lon = Number(longitude);

    try {
      const disastersPromise = fetchJson('/api/disasters?limit=8').catch(() => null);
      const weatherPromise = hasCoordinates
        ? fetchJson(`/api/weather/location?lat=${lat}&lon=${lon}`).catch(() => null)
        : Promise.resolve(null);
      const aqiPromise = hasCoordinates
        ? fetchJson(`/api/aqi/location?lat=${lat}&lon=${lon}`).catch(() => null)
        : Promise.resolve(null);
      const servicesPromise = hasCoordinates
        ? fetchJson(`/api/location/nearby-services?lat=${lat}&lon=${lon}&radius_km=8&categories=hospital,police,fire_station,shelter`).catch(() => null)
        : Promise.resolve(null);

      const [disastersData, weatherData, aqiData, servicesData] = await Promise.all([
        disastersPromise,
        weatherPromise,
        aqiPromise,
        servicesPromise,
      ]);

      setDisasterFeed(Array.isArray(disastersData?.disasters) ? disastersData.disasters.slice(0, 6) : []);
      setWeatherSnapshot(weatherData?.current || null);
      setAqiSnapshot(aqiData || null);
      setNearbyServices(Array.isArray(servicesData?.services) ? servicesData.services.slice(0, 6) : []);

      if (!disastersData && !weatherData && !aqiData && !servicesData) {
        setLiveDataError('Live data is temporarily unavailable. You can still use all learning modules.');
      }
    } catch {
      setLiveDataError('Could not refresh live data right now. Please try again in a moment.');
      setDisasterFeed([]);
      setWeatherSnapshot(null);
      setAqiSnapshot(null);
      setNearbyServices([]);
    } finally {
      setLiveDataLoading(false);
    }
  }, [fetchJson, hasCoordinates, latitude, longitude]);

  useEffect(() => {
    localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(checklistState));
  }, [checklistState]);

  useEffect(() => {
    localStorage.setItem(QUIZ_PROGRESS_STORAGE_KEY, JSON.stringify(quizProgress));
  }, [quizProgress]);

  useEffect(() => {
    refreshStudentData();
  }, [refreshStudentData]);

  const checklistCompleted = useMemo(
    () => CHECKLIST_ITEMS.filter((item) => checklistState[item.id]).length,
    [checklistState]
  );

  const quizAverageScore = useMemo(() => {
    const total = QUIZ_CATEGORIES.reduce(
      (sum, category) => sum + (quizProgress.bestScores?.[category.id] || 0),
      0
    );
    return Math.round(total / QUIZ_CATEGORIES.length);
  }, [quizProgress.bestScores]);

  const highestAlertSeverity = useMemo(() => {
    if (!alerts?.length) return 'none';
    const severityRank = { critical: 4, high: 3, warning: 2, moderate: 2, medium: 2, low: 1 };
    const normalized = alerts.map((alert) => String(alert?.severity || 'low').toLowerCase());
    const top = normalized.reduce((acc, cur) => (severityRank[cur] > severityRank[acc] ? cur : acc), 'low');
    return top;
  }, [alerts]);

  const readinessScore = useMemo(() => {
    const checklistPoints = (checklistCompleted / CHECKLIST_ITEMS.length) * 45;
    const quizPoints = (quizAverageScore / 100) * 35;
    const basePoints = 20;
    const alertPenalty = Math.min(25, (alerts?.length || 0) * 4);
    return Math.max(0, Math.round(checklistPoints + quizPoints + basePoints - alertPenalty));
  }, [alerts?.length, checklistCompleted, quizAverageScore]);

  const handleChecklistChange = (itemId, checked) => {
    setChecklistState((prev) => ({
      ...prev,
      [itemId]: checked === true,
    }));
  };

  const handleQuizComplete = useCallback((result) => {
    setQuizProgress((prev) => {
      const previousBest = prev.bestScores?.[result.category] || 0;
      return {
        attempts: (prev.attempts || 0) + 1,
        bestScores: {
          ...(prev.bestScores || {}),
          [result.category]: Math.max(previousBest, result.percentage),
        },
        completedCategories: {
          ...(prev.completedCategories || {}),
          [result.category]: true,
        },
        totalTimeSeconds: (prev.totalTimeSeconds || 0) + (result.timeSpent || 0),
        lastCompletedAt: result.completedAt,
      };
    });
  }, []);

  const getServiceIcon = (serviceType) => {
    switch (serviceType) {
      case 'hospital':
        return <Hospital className="h-4 w-4 text-red-500" />;
      case 'police':
        return <Shield className="h-4 w-4 text-blue-500" />;
      case 'fire_station':
        return <Flame className="h-4 w-4 text-orange-500" />;
      default:
        return <Siren className="h-4 w-4 text-teal-500" />;
    }
  };

  const handleRefreshClick = async () => {
    refreshNearbyAlerts();
    await refreshStudentData();
  };

  const aqiLabel = aqiSnapshot?.aqi_label || 'Unavailable';
  const locationLabel = location?.city || location?.state || 'Location not set';
  const initialPortalLoading = (locationLoading || liveDataLoading) && !location && !weatherSnapshot && !aqiSnapshot;

  if (initialPortalLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6">
        <Skeleton className="h-40 rounded-xl" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-[420px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-6 py-7 text-white">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight">Student Safety Lab</h1>
              <p className="max-w-2xl text-sm text-teal-50 md:text-base">
                Practice real emergency skills with live local context, guided quizzes, and an AI safety coach.
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm">
                <Badge className="bg-white/20 text-white hover:bg-white/20">
                  <MapPin className="mr-1 h-3.5 w-3.5" />
                  {locationLabel}
                </Badge>
                <Badge className="bg-white/20 text-white hover:bg-white/20">
                  <Shield className="mr-1 h-3.5 w-3.5" />
                  {wsConnected ? 'Live alerts connected' : 'Live alerts reconnecting'}
                </Badge>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="gap-2"
                onClick={detectLocation}
                disabled={locationLoading}
              >
                <LocateFixed className="h-4 w-4" />
                {locationLoading ? 'Detecting...' : 'Detect Location'}
              </Button>
              <Button
                variant="secondary"
                className="gap-2"
                onClick={handleRefreshClick}
                disabled={liveDataLoading}
              >
                <RefreshCw className={`h-4 w-4 ${liveDataLoading ? 'animate-spin' : ''}`} />
                Refresh Feed
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Readiness Score</CardDescription>
            <CardTitle className="flex items-center justify-between text-2xl">
              {readinessScore}%
              <Trophy className="h-5 w-5 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Progress value={readinessScore} className="h-2" />
            <p className="text-xs text-muted-foreground">
              Built from checklist completion, quiz performance, and local alert conditions.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Nearby Alerts</CardDescription>
            <CardTitle className="flex items-center justify-between text-2xl">
              {alerts?.length || 0}
              <AlertTriangle className="h-5 w-5 text-rose-500" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={highestAlertSeverity === 'none' ? 'secondary' : 'destructive'}>
              Highest severity: {highestAlertSeverity}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Current Weather</CardDescription>
            <CardTitle className="flex items-center justify-between text-2xl">
              {toDisplayNumber(weatherSnapshot?.temperature, 'C')}
              <ThermometerSun className="h-5 w-5 text-orange-500" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{weatherSnapshot?.condition || 'No weather data yet'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Air Quality</CardDescription>
            <CardTitle className="flex items-center justify-between text-2xl">
              {toDisplayNumber(aqiSnapshot?.aqi)}
              <Wind className="h-5 w-5 text-sky-500" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{aqiLabel}</p>
          </CardContent>
        </Card>
      </div>

      {liveDataError && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
          <CardContent className="py-3 text-sm text-amber-800 dark:text-amber-200">
            {liveDataError}
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="practice">Practice</TabsTrigger>
          <TabsTrigger value="ai-coach">AI Coach</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-teal-600" />
                    Learning Tracks
                  </CardTitle>
                  <CardDescription>
                    Structured mini-modules that pair with your local conditions.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {LEARNING_TRACKS.map((track) => (
                    <div key={track.id} className="rounded-lg border p-4">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="font-medium">{track.title}</p>
                        <Badge variant="secondary">{track.duration}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{track.description}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CloudRain className="h-5 w-5 text-sky-600" />
                    Live Disaster Feed
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!disasterFeed.length && (
                    <p className="text-sm text-muted-foreground">
                      {liveDataLoading ? 'Fetching latest incidents...' : 'No live incidents available right now.'}
                    </p>
                  )}
                  {disasterFeed.map((item) => (
                    <div key={item.id} className="rounded-lg border p-4">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{item.title || 'Incident'}</p>
                        <Badge variant="outline">{String(item.severity || 'unknown')}</Badge>
                      </div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {item.type || 'unknown'} · {item.location || 'Location unavailable'}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Siren className="h-5 w-5 text-rose-600" />
                    Nearby Emergency Services
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!hasCoordinates && (
                    <p className="text-sm text-muted-foreground">
                      Detect your location to load nearby hospitals, police stations, and shelters.
                    </p>
                  )}
                  {hasCoordinates && !nearbyServices.length && (
                    <p className="text-sm text-muted-foreground">
                      {liveDataLoading ? 'Loading nearby services...' : 'No nearby services found yet.'}
                    </p>
                  )}
                  {nearbyServices.map((service) => (
                    <div key={service.id} className="flex items-start gap-3 rounded-lg border p-3">
                      <div className="mt-0.5">{getServiceIcon(service.service_type)}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{service.name || 'Emergency service'}</p>
                        <p className="text-xs text-muted-foreground">
                          {service.distance_km != null ? `${service.distance_km} km away` : 'Distance unavailable'}
                        </p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Shield className="h-5 w-5 text-emerald-600" />
                    Personal Readiness Checklist
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Checklist progress</span>
                      <span>{checklistCompleted}/{CHECKLIST_ITEMS.length}</span>
                    </div>
                    <Progress value={(checklistCompleted / CHECKLIST_ITEMS.length) * 100} className="h-2" />
                  </div>
                  {CHECKLIST_ITEMS.map((item) => (
                    <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm">
                      <Checkbox
                        checked={Boolean(checklistState[item.id])}
                        onCheckedChange={(checked) => handleChecklistChange(item.id, checked)}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="practice" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-indigo-600" />
                Quiz Performance
              </CardTitle>
              <CardDescription>
                Local scoring with saved progress, no fragile backend dependency.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Attempts</p>
                <p className="text-2xl font-bold">{quizProgress.attempts || 0}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Average Best Score</p>
                <p className="text-2xl font-bold">{quizAverageScore}%</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Completed Topics</p>
                <p className="text-2xl font-bold">{Object.keys(quizProgress.completedCategories || {}).length}</p>
              </div>
            </CardContent>
          </Card>

          {activeQuiz ? (
            <div className="space-y-3">
              <Button variant="ghost" onClick={() => setActiveQuiz(null)}>
                ← Back to quiz categories
              </Button>
              <Quiz category={activeQuiz} onComplete={handleQuizComplete} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {QUIZ_CATEGORIES.map((quiz) => (
                <Card key={quiz.id} className="overflow-hidden">
                  <div className={`h-2 bg-gradient-to-r ${quiz.color}`} />
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-2xl">{quiz.icon}</p>
                        <p className="font-semibold">{quiz.title}</p>
                      </div>
                      <Badge variant="outline">{quiz.difficulty}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{quiz.description}</p>
                    <p className="text-xs text-muted-foreground">{quiz.questions} questions</p>
                    <p className="text-xs font-medium text-teal-700 dark:text-teal-300">
                      Best: {quizProgress.bestScores?.[quiz.id] || 0}%
                    </p>
                    <Button className="w-full" onClick={() => setActiveQuiz(quiz.id)}>
                      Start Quiz
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="ai-coach" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <StudentChat />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Waves className="h-5 w-5 text-cyan-600" />
                  Guided Prompt Ideas
                </CardTitle>
                <CardDescription>
                  Use these prompts in chat for practical preparation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-md border p-3">Give me a 7-day home safety drill plan for students in {locationLabel}.</div>
                <div className="rounded-md border p-3">What should I do in the first 30 minutes after a nearby {highestAlertSeverity} alert?</div>
                <div className="rounded-md border p-3">Create a revision cheat-sheet for flood, fire, cyclone, and earthquake safety.</div>
                <div className="rounded-md border p-3">Test me with 5 rapid-fire safety questions and explain mistakes.</div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default StudentPortal;

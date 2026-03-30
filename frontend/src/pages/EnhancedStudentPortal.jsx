import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  BookOpen,
  Trophy,
  Gamepad2,
  Download,
  Play,
  CheckCircle,
  Clock,
  Star,
  Award,
  FileJson,
  FileSpreadsheet
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import InteractiveQuiz from '@/components/student/InteractiveQuiz';
import { toast } from 'sonner';

const BACKEND = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

const EnhancedStudentPortal = () => {
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [userProgress, setUserProgress] = useState({
    level: 5,
    xp: 2450,
    xpToNextLevel: 500,
    completedModules: ['earthquake'],
    badges: ['flood_ready', 'fire_safety']
  });

  const modules = [
    {
      id: 1,
      title: 'Earthquake Safety',
      description: 'Master earthquake preparedness and response',
      icon: '🏚️',
      xp: 250,
      duration: '15 min',
      lessons: 3,
      completed: true,
      quiz: 'earthquake'
    },
    {
      id: 2,
      title: 'Cyclone Survival',
      description: 'Understand cyclone formation and safety',
      icon: '🌀',
      xp: 300,
      duration: '20 min',
      lessons: 3,
      completed: false,
      quiz: 'cyclone'
    },
    {
      id: 3,
      title: 'Flood Preparedness',
      description: 'Learn flood safety and evacuation procedures',
      icon: '🌊',
      xp: 280,
      duration: '18 min',
      lessons: 4,
      completed: false,
      quiz: 'flood'
    },
    {
      id: 4,
      title: 'Fire Safety',
      description: 'Essential fire prevention and escape planning',
      icon: '🔥',
      xp: 220,
      duration: '12 min',
      lessons: 3,
      completed: false,
      quiz: null
    }
  ];

  const datasets = [
    {
      id: 1,
      name: 'Historical Earthquake Data',
      description: 'Earthquake records from India (2000-2026)',
      format: 'CSV',
      size: '2.5 MB',
      icon: FileSpreadsheet,
      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
    },
    {
      id: 2,
      name: 'Cyclone Tracks Dataset',
      description: 'Indian Ocean cyclone paths and intensity',
      format: 'JSON',
      size: '1.8 MB',
      icon: FileJson,
      color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400'
    },
    {
      id: 3,
      name: 'Rainfall Patterns',
      description: 'Monthly rainfall data by region',
      format: 'CSV',
      size: '3.2 MB',
      icon: FileSpreadsheet,
      color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-400'
    },
    {
      id: 4,
      name: 'Disaster Impact Statistics',
      description: 'Economic and human impact data',
      format: 'XLSX',
      size: '4.1 MB',
      icon: FileSpreadsheet,
      color: 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
    }
  ];

  const badges = {
    flood_ready: { name: 'Flood Ready', icon: '🌊', color: 'bg-blue-500' },
    fire_safety: { name: 'Fire Safety', icon: '🔥', color: 'bg-red-500' },
    cyclone_pro: { name: 'Cyclone Pro', icon: '🌀', color: 'bg-purple-500' },
    earthquake_expert: { name: 'Earthquake Expert', icon: '🏚️', color: 'bg-yellow-500' },
    first_responder: { name: 'First Responder', icon: '🚑', color: 'bg-green-500' },
    safety_champion: { name: 'Safety Champion', icon: '🏆', color: 'bg-amber-500' }
  };

  const handleDownloadDataset = async (datasetId) => {
    try {
      toast.promise(
        fetch(`${BACKEND}/api/datasets/${datasetId}/download`).then(res => {
          if (!res.ok) throw new Error('Download failed');
          return res.blob();
        }).then(blob => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = datasets.find(d => d.id === datasetId)?.name + `.${datasets.find(d => d.id === datasetId)?.format.toLowerCase()}`;
          a.click();
          window.URL.revokeObjectURL(url);
        }),
        {
          loading: 'Downloading dataset...',
          success: 'Dataset downloaded successfully!',
          error: 'Download failed'
        }
      );
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  const handleStartQuiz = (quizId) => {
    setActiveQuiz(quizId);
  };

  const handleQuizComplete = (result) => {
    if (result.passed) {
      setUserProgress(prev => ({
        ...prev,
        xp: prev.xp + result.xp_earned,
        completedModules: [...prev.completedModules, result.quiz_id]
      }));
    }
  };

  const xpProgress = (userProgress.xp % userProgress.xpToNextLevel) / userProgress.xpToNextLevel * 100;

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      {/* Header with Progress */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Student Learning Zone</h1>
          <p className="text-muted-foreground">Learn disaster safety through interactive lessons and quizzes</p>
        </div>
        <Card className="p-4">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <Trophy className="w-8 h-8 text-yellow-500 mx-auto mb-1" />
              <p className="text-sm font-medium">Level {userProgress.level}</p>
            </div>
            <div className="flex-1 min-w-[200px]">
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">{userProgress.xp} XP</span>
                <span className="text-muted-foreground">{userProgress.xpToNextLevel} XP</span>
              </div>
              <Progress value={xpProgress} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1">
                {userProgress.xpToNextLevel - (userProgress.xp % userProgress.xpToNextLevel)} XP to Level {userProgress.level + 1}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Tabs defaultValue="modules" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
          <TabsTrigger value="modules">
            <BookOpen className="w-4 h-4 mr-2" />
            Modules
          </TabsTrigger>
          <TabsTrigger value="datasets">
            <Download className="w-4 h-4 mr-2" />
            Datasets
          </TabsTrigger>
          <TabsTrigger value="badges">
            <Award className="w-4 h-4 mr-2" />
            Badges
          </TabsTrigger>
        </TabsList>

        {/* Learning Modules */}
        <TabsContent value="modules" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {modules.map((module) => (
              <motion.div
                key={module.id}
                whileHover={{ scale: 1.02 }}
                transition={{ type: 'spring', stiffness: 300 }}
              >
                <Card className={`overflow-hidden ${module.completed ? 'border-green-500 border-2' : ''}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="text-4xl">{module.icon}</div>
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            {module.title}
                            {module.completed && <CheckCircle className="w-5 h-5 text-green-500" />}
                          </CardTitle>
                          <CardDescription>{module.description}</CardDescription>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {module.duration}
                      </div>
                      <div className="flex items-center gap-1">
                        <BookOpen className="w-4 h-4" />
                        {module.lessons} lessons
                      </div>
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 text-yellow-500" />
                        +{module.xp} XP
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button className="flex-1 gap-2" variant="outline">
                        <Play className="w-4 h-4" />
                        Start Learning
                      </Button>
                      {module.quiz && (
                        <Button 
                          className="flex-1 gap-2"
                          onClick={() => handleStartQuiz(module.quiz)}
                        >
                          <Gamepad2 className="w-4 h-4" />
                          Take Quiz
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </TabsContent>

        {/* Datasets */}
        <TabsContent value="datasets" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Educational Datasets</CardTitle>
              <CardDescription>Download real disaster data for research and learning</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {datasets.map((dataset) => {
                  const Icon = dataset.icon;
                  return (
                    <div
                      key={dataset.id}
                      className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-lg ${dataset.color}`}>
                          <Icon className="w-6 h-6" />
                        </div>
                        <div>
                          <h4 className="font-semibold">{dataset.name}</h4>
                          <p className="text-sm text-muted-foreground">{dataset.description}</p>
                          <div className="flex gap-2 mt-1">
                            <Badge variant="secondary">{dataset.format}</Badge>
                            <Badge variant="outline">{dataset.size}</Badge>
                          </div>
                        </div>
                      </div>
                      <Button
                        onClick={() => handleDownloadDataset(dataset.id)}
                        variant="outline"
                        className="gap-2"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Badges */}
        <TabsContent value="badges" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Achievement Badges</CardTitle>
              <CardDescription>Earn badges by completing modules and quizzes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                {Object.entries(badges).map(([key, badge]) => {
                  const isEarned = userProgress.badges.includes(key);
                  return (
                    <motion.div
                      key={key}
                      whileHover={isEarned ? { scale: 1.05 } : {}}
                      className={`text-center p-6 rounded-lg border-2 ${
                        isEarned ? 'border-primary bg-primary/5' : 'border-dashed opacity-50 grayscale'
                      }`}
                    >
                      <div className={`w-20 h-20 mx-auto mb-3 rounded-full ${badge.color} flex items-center justify-center text-4xl`}>
                        {badge.icon}
                      </div>
                      <h4 className="font-semibold">{badge.name}</h4>
                      {isEarned ? (
                        <Badge className="mt-2" variant="default">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Earned
                        </Badge>
                      ) : (
                        <Badge className="mt-2" variant="outline">
                          Locked
                        </Badge>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Quiz Dialog */}
      <Dialog open={activeQuiz !== null} onOpenChange={() => setActiveQuiz(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {activeQuiz && modules.find(m => m.quiz === activeQuiz)?.title} Quiz
            </DialogTitle>
          </DialogHeader>
          {activeQuiz && (
            <InteractiveQuiz
              quizId={activeQuiz}
              onComplete={handleQuizComplete}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EnhancedStudentPortal;

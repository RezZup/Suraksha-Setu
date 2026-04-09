import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, XCircle, Trophy, Award, Clock, 
  Brain, Zap, Target, ArrowRight, RotateCw
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

const QUIZ_DATA = {
  earthquake: {
    title: 'Earthquake Safety',
    description: 'Test your knowledge about earthquake preparedness and response',
    icon: '🌍',
    color: 'from-red-500 to-orange-500',
    questions: [
      {
        id: 1,
        question: 'What should you do immediately when you feel an earthquake?',
        options: [
          'Run outside immediately',
          'Drop, Cover, and Hold On',
          'Stand in a doorway',
          'Call emergency services'
        ],
        correctAnswer: 1,
        explanation: 'The safest action during an earthquake is to Drop, Cover, and Hold On. Drop to your hands and knees, take cover under a sturdy desk or table, and hold on until the shaking stops.'
      },
      {
        id: 2,
        question: 'Where is the safest place to be during an earthquake if you are indoors?',
        options: [
          'Near windows',
          'Under a sturdy desk or table',
          'In an elevator',
          'Next to a wall'
        ],
        correctAnswer: 1,
        explanation: 'Taking cover under a sturdy desk or table protects you from falling objects and provides a shield during the earthquake.'
      },
      {
        id: 3,
        question: 'What should you include in an earthquake emergency kit?',
        options: [
          'Only food and water',
          'Water, food, flashlight, first-aid kit, and battery-powered radio',
          'Just a flashlight',
          'Only important documents'
        ],
        correctAnswer: 1,
        explanation: 'A complete emergency kit should include water (1 gallon per person per day), non-perishable food, flashlight, first-aid kit, battery-powered radio, extra batteries, and important documents.'
      },
      {
        id: 4,
        question: 'After an earthquake stops, what should you do first?',
        options: [
          'Immediately go back inside',
          'Check for injuries and hazards',
          'Post on social media',
          'Take photos of damage'
        ],
        correctAnswer: 1,
        explanation: 'After an earthquake, first check yourself and others for injuries. Check for gas leaks, damaged electrical wiring, and structural damage before taking any other action.'
      },
      {
        id: 5,
        question: 'True or False: You should use elevators during an earthquake.',
        options: [
          'True',
          'False'
        ],
        correctAnswer: 1,
        explanation: 'Never use elevators during an earthquake. They can malfunction or get stuck, trapping you inside. Always use stairs for evacuation.'
      }
    ]
  },
  flood: {
    title: 'Flood Preparedness',
    description: 'Learn essential flood safety measures',
    icon: '🌊',
    color: 'from-blue-500 to-cyan-500',
    questions: [
      {
        id: 1,
        question: 'What is the minimum depth of water that can sweep away a car?',
        options: [
          '6 feet',
          '3 feet',
          '12 inches',
          '6 inches'
        ],
        correctAnswer: 2,
        explanation: 'Just 12 inches (1 foot) of moving water can carry away most vehicles, including SUVs and pickup trucks. Never drive through flooded areas.'
      },
      {
        id: 2,
        question: 'During a flood warning, what should you do first?',
        options: [
          'Wait and see if it gets worse',
          'Move to higher ground immediately',
          'Drive to check on relatives',
          'Go to the basement'
        ],
        correctAnswer: 1,
        explanation: 'When a flood warning is issued, move to higher ground immediately. Don\'t wait for the water to rise. Basements are the most dangerous places during floods.'
      },
      {
        id: 3,
        question: 'If trapped in a building during a flood, where should you go?',
        options: [
          'Basement',
          'First floor',
          'Highest floor possible',
          'Stay where you are'
        ],
        correctAnswer: 2,
        explanation: 'If trapped in a building, go to the highest floor or even the roof if necessary. Never go to the basement or stay on lower floors when water is rising.'
      },
      {
        id: 4,
        question: 'What should you do if you encounter a flooded road while driving?',
        options: [
          'Drive through quickly',
          'Turn around and find another route',
          'Wait in your car',
          'Test the depth with your car'
        ],
        correctAnswer: 1,
        explanation: 'Turn Around, Don\'t Drown! Never drive through flooded roads. Find an alternative route or wait until the water recedes.'
      },
      {
        id: 5,
        question: 'How many inches of flowing water can knock a person down?',
        options: [
          '12 inches',
          '6 inches',
          '2 inches',
          '24 inches'
        ],
        correctAnswer: 1,
        explanation: 'Just 6 inches of moving water can knock you down. Never walk through flowing water, even if it seems shallow.'
      }
    ]
  },
  cyclone: {
    title: 'Cyclone Safety',
    description: 'Understanding tropical cyclones and staying safe',
    icon: '🌪️',
    color: 'from-purple-500 to-indigo-500',
    questions: [
      {
        id: 1,
        question: 'What is the eye of a cyclone?',
        options: [
          'The most dangerous part with strongest winds',
          'The calm center with light winds',
          'The area where it forms',
          'The outer edge'
        ],
        correctAnswer: 1,
        explanation: 'The eye is the calm center of a cyclone with light winds and clear skies. However, the eye wall surrounding it has the strongest winds and is the most dangerous part.'
      },
      {
        id: 2,
        question: 'Where is the safest room in your house during a cyclone?',
        options: [
          'Room with large windows',
          'Interior room on the lowest floor away from windows',
          'Kitchen',
          'Balcony'
        ],
        correctAnswer: 1,
        explanation: 'The safest place is an interior room (like a bathroom or closet) on the lowest floor, away from windows. This protects you from flying debris and structural collapse.'
      },
      {
        id: 3,
        question: 'When should you evacuate during a cyclone warning?',
        options: [
          'When you see heavy rain',
          'As soon as evacuation orders are issued',
          'After the cyclone makes landfall',
          'When power goes out'
        ],
        correctAnswer: 1,
        explanation: 'Evacuate immediately when evacuation orders are issued by authorities. Waiting until conditions worsen can trap you in dangerous situations.'
      },
      {
        id: 4,
        question: 'What supplies should you have for at least 3 days during a cyclone?',
        options: [
          'Only water',
          'Food, water, medications, flashlight, batteries, first-aid kit',
          'Just a phone charger',
          'Only canned food'
        ],
        correctAnswer: 1,
        explanation: 'Have at least a 3-day supply of water (1 gallon per person per day), non-perishable food, medications, flashlight, extra batteries, battery-powered radio, and first-aid supplies.'
      },
      {
        id: 5,
        question: 'After a cyclone passes and conditions seem calm, what should you do?',
        options: [
          'Go outside immediately',
          'Stay indoors until official all-clear is given',
          'Check on all neighbors right away',
          'Start cleaning outside'
        ],
        correctAnswer: 1,
        explanation: 'Stay indoors until authorities give an official all-clear. The calm might be the eye of the cyclone passing, and dangerous winds may resume. Also, hazards like downed power lines may exist outside.'
      }
    ]
  },
  fire: {
    title: 'Fire Safety',
    description: 'Critical fire safety and prevention knowledge',
    icon: '🔥',
    color: 'from-orange-500 to-red-600',
    questions: [
      {
        id: 1,
        question: 'If your clothes catch fire, what should you do?',
        options: [
          'Run to find water',
          'Stop, Drop, and Roll',
          'Try to remove the clothing',
          'Scream for help'
        ],
        correctAnswer: 1,
        explanation: 'Stop, Drop, and Roll! Stop immediately, drop to the ground, cover your face with your hands, and roll over to smother the flames.'
      },
      {
        id: 2,
        question: 'What should you do if you encounter smoke while escaping a fire?',
        options: [
          'Stand upright and run',
          'Crawl low under the smoke',
          'Hold your breath and run through',
          'Wait for it to clear'
        ],
        correctAnswer: 1,
        explanation: 'Crawl low under smoke because hot air and smoke rise. Cleaner, cooler air is near the floor. Cover your nose and mouth with a cloth if possible.'
      },
      {
        id: 3,
        question: 'Before opening a door during a fire, you should:',
        options: [
          'Open it immediately',
          'Feel the door with the back of your hand for heat',
          'Kick it open',
          'Wait 5 minutes'
        ],
        correctAnswer: 1,
        explanation: 'Always feel the door with the back of your hand before opening. If it\'s hot, there may be fire on the other side. Find another escape route.'
      },
      {
        id: 4,
        question: 'How often should you test smoke alarms?',
        options: [
          'Once a year',
          'Every 6 months',
          'Once a month',
          'Never, they don\'t need testing'
        ],
        correctAnswer: 2,
        explanation: 'Test smoke alarms monthly by pressing the test button. Replace batteries at least once a year, and replace the entire unit every 10 years.'
      },
      {
        id: 5,
        question: 'If you cannot escape a burning building, what should you do?',
        options: [
          'Hide in a closet',
          'Close doors, seal cracks, signal for help from a window',
          'Try to fight the fire yourself',
          'Jump from a window'
        ],
        correctAnswer: 1,
        explanation: 'If trapped, close all doors between you and the fire, seal cracks with wet towels, call 911, and signal for help from a window. Stay low and wait for rescue.'
      }
    ]
  }
};

const Quiz = ({ category = 'earthquake', onComplete }) => {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [score, setScore] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [quizComplete, setQuizComplete] = useState(false);
  const [timeSpent, setTimeSpent] = useState(0);
  const [startTime] = useState(Date.now());

  const quiz = QUIZ_DATA[category];
  const questions = quiz.questions;
  const currentQ = questions[currentQuestion];
  const progress = ((currentQuestion + 1) / questions.length) * 100;

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeSpent(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  const handleAnswerSelect = (answerIndex) => {
    if (selectedAnswer !== null) return; // Already answered
    
    setSelectedAnswer(answerIndex);
    setShowExplanation(true);

    const isCorrect = answerIndex === currentQ.correctAnswer;
    if (isCorrect) {
      setScore(score + 1);
    }

    setAnswers([...answers, {
      questionId: currentQ.id,
      selected: answerIndex,
      correct: currentQ.correctAnswer,
      isCorrect
    }]);
  };

  const handleNext = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
      setSelectedAnswer(null);
      setShowExplanation(false);
    } else {
      if (typeof onComplete === 'function') {
        onComplete({
          category,
          score,
          totalQuestions: questions.length,
          percentage: Math.round((score / questions.length) * 100),
          timeSpent,
          completedAt: new Date().toISOString(),
        });
      }
      setQuizComplete(true);
    }
  };

  const handleRestart = () => {
    setCurrentQuestion(0);
    setSelectedAnswer(null);
    setShowExplanation(false);
    setScore(0);
    setAnswers([]);
    setQuizComplete(false);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getScoreLabel = () => {
    const percentage = (score / questions.length) * 100;
    if (percentage === 100) return { text: 'Perfect!', icon: '🏆', color: 'text-yellow-500' };
    if (percentage >= 80) return { text: 'Excellent!', icon: '⭐', color: 'text-green-500' };
    if (percentage >= 60) return { text: 'Good Job!', icon: '👍', color: 'text-blue-500' };
    if (percentage >= 40) return { text: 'Keep Learning!', icon: '📚', color: 'text-orange-500' };
    return { text: 'Try Again!', icon: '💪', color: 'text-red-500' };
  };

  if (quizComplete) {
    const scoreLabel = getScoreLabel();
    const percentage = Math.round((score / questions.length) * 100);

    return (
      <Card className="w-full max-w-3xl mx-auto">
        <CardContent className="p-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="text-center space-y-6"
          >
            {/* Trophy Icon */}
            <div className="flex justify-center">
              <div className={`text-8xl ${scoreLabel.color}`}>
                {scoreLabel.icon}
              </div>
            </div>

            {/* Score */}
            <div>
              <h2 className="text-3xl font-bold mb-2">{scoreLabel.text}</h2>
              <p className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                {score} / {questions.length}
              </p>
              <p className="text-lg text-muted-foreground mt-2">
                {percentage}% Correct
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 py-6">
              <div className="text-center p-4 bg-muted rounded-lg">
                <Trophy className="w-6 h-6 mx-auto mb-2 text-yellow-500" />
                <p className="text-2xl font-bold">{score}</p>
                <p className="text-xs text-muted-foreground">Correct</p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <Target className="w-6 h-6 mx-auto mb-2 text-blue-500" />
                <p className="text-2xl font-bold">{percentage}%</p>
                <p className="text-xs text-muted-foreground">Accuracy</p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <Clock className="w-6 h-6 mx-auto mb-2 text-green-500" />
                <p className="text-2xl font-bold">{formatTime(timeSpent)}</p>
                <p className="text-xs text-muted-foreground">Time</p>
              </div>
            </div>

            {/* Certificate Message */}
            {percentage >= 80 && (
              <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-950 dark:to-orange-950 border-2 border-yellow-300 dark:border-yellow-700 rounded-lg">
                <Award className="w-8 h-8 mx-auto mb-2 text-yellow-600" />
                <p className="font-semibold text-yellow-900 dark:text-yellow-100">
                  🎉 Congratulations! You've earned a certificate!
                </p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  You've demonstrated excellent knowledge of {quiz.title.toLowerCase()}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 justify-center">
              <Button onClick={handleRestart} className="gap-2">
                <RotateCw className="w-4 h-4" />
                Try Again
              </Button>
              {percentage >= 80 && (
                <Button variant="outline" className="gap-2">
                  <Award className="w-4 h-4" />
                  View Certificate
                </Button>
              )}
            </div>
          </motion.div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-3xl mx-auto">
      <CardContent className="p-0">
        {/* Header */}
        <div className={`bg-gradient-to-r ${quiz.color} p-6 text-white`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-4xl">{quiz.icon}</span>
              <div>
                <h2 className="text-2xl font-bold">{quiz.title}</h2>
                <p className="text-white/80 text-sm">{quiz.description}</p>
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2 text-white/90">
                <Clock className="w-4 h-4" />
                <span className="font-mono">{formatTime(timeSpent)}</span>
              </div>
            </div>
          </div>

          {/* Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-white/90">
              <span>Question {currentQuestion + 1} of {questions.length}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2 bg-white/20" />
          </div>
        </div>

        {/* Question */}
        <div className="p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentQuestion}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Question Text */}
              <div className="mb-6">
                <div className="flex items-start gap-3 mb-4">
                  <Badge variant="default" className="mt-1">
                    Q{currentQuestion + 1}
                  </Badge>
                  <h3 className="text-xl font-semibold">{currentQ.question}</h3>
                </div>
              </div>

              {/* Answer Options */}
              <div className="space-y-3 mb-6">
                {currentQ.options.map((option, index) => {
                  const isSelected = selectedAnswer === index;
                  const isCorrect = index === currentQ.correctAnswer;
                  const showResult = selectedAnswer !== null;

                  return (
                    <motion.button
                      key={index}
                      onClick={() => handleAnswerSelect(index)}
                      disabled={selectedAnswer !== null}
                      whileHover={selectedAnswer === null ? { scale: 1.02 } : {}}
                      whileTap={selectedAnswer === null ? { scale: 0.98 } : {}}
                      className={cn(
                        "w-full p-4 rounded-lg border-2 text-left transition-all",
                        "flex items-center gap-3",
                        !showResult && "hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950",
                        !showResult && "border-gray-200 dark:border-gray-700",
                        isSelected && !showResult && "border-blue-500 bg-blue-50 dark:bg-blue-950",
                        showResult && isCorrect && "border-green-500 bg-green-50 dark:bg-green-950",
                        showResult && isSelected && !isCorrect && "border-red-500 bg-red-50 dark:bg-red-950",
                        showResult && !isSelected && !isCorrect && "opacity-50"
                      )}
                    >
                      <div className={cn(
                        "w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                        !showResult && "border-gray-300",
                        showResult && isCorrect && "border-green-500 bg-green-500",
                        showResult && isSelected && !isCorrect && "border-red-500 bg-red-500"
                      )}>
                        {showResult && isCorrect && <CheckCircle2 className="w-4 h-4 text-white" />}
                        {showResult && isSelected && !isCorrect && <XCircle className="w-4 h-4 text-white" />}
                      </div>
                      <span className="flex-1">{option}</span>
                    </motion.button>
                  );
                })}
              </div>

              {/* Explanation */}
              <AnimatePresence>
                {showExplanation && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={cn(
                      "p-4 rounded-lg mb-6",
                      selectedAnswer === currentQ.correctAnswer
                        ? "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800"
                        : "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {selectedAnswer === currentQ.correctAnswer ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
                      )}
                      <div>
                        <p className={cn(
                          "font-semibold mb-1",
                          selectedAnswer === currentQ.correctAnswer
                            ? "text-green-900 dark:text-green-100"
                            : "text-red-900 dark:text-red-100"
                        )}>
                          {selectedAnswer === currentQ.correctAnswer ? 'Correct!' : 'Incorrect'}
                        </p>
                        <p className={cn(
                          "text-sm",
                          selectedAnswer === currentQ.correctAnswer
                            ? "text-green-700 dark:text-green-300"
                            : "text-red-700 dark:text-red-300"
                        )}>
                          {currentQ.explanation}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Next Button */}
              {selectedAnswer !== null && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  <Button 
                    onClick={handleNext}
                    className="w-full gap-2"
                    size="lg"
                  >
                    {currentQuestion < questions.length - 1 ? (
                      <>
                        Next Question
                        <ArrowRight className="w-4 h-4" />
                      </>
                    ) : (
                      <>
                        View Results
                        <Trophy className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
};

export default Quiz;

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowRight,
  BookOpen,
  Cpu,
  Languages,
  Map,
  Shield,
  Target
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Skeleton } from 'boneyard-js/react';

const Landing = () => {
  const navigate = useNavigate();

  const fadeInUp = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6 }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-white text-slate-900">
      <style>{`
        .skew-login-btn {
          background: #fff;
          border: none;
          padding: 10px 20px;
          display: inline-block;
          font-size: 15px;
          font-weight: 600;
          width: 120px;
          text-transform: uppercase;
          cursor: pointer;
          transform: skew(-21deg);
          position: relative;
          overflow: hidden;
          color: #111;
          border: 1px solid #111;
        }
        .skew-login-btn span {
          display: inline-block;
          transform: skew(21deg);
        }
        .skew-login-btn::before {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          right: 100%;
          left: 0;
          background: rgb(20, 20, 20);
          opacity: 0;
          z-index: -1;
          transition: all 0.5s;
        }
        .skew-login-btn:hover {
          color: #fff;
        }
        .skew-login-btn:hover::before {
          left: 0;
          right: 0;
          opacity: 1;
        }
      `}</style>

      {/* Navigation */}
      <nav className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
              <img src="/main_logo.png" alt="Logo" className="w-10 h-10 object-contain" />
            </div>
            <span className="text-2xl font-semibold tracking-tight">Suraksha Setu</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="skew-login-btn"
              onClick={() => navigate('/app/dashboard')}
            >
              <span>Login</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <Skeleton name="landing-hero" loading={false}>
      <section className="relative overflow-hidden py-24 px-4">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_#f8fafc,_#ffffff)]"></div>
        <div className="max-w-6xl mx-auto relative">
          <motion.div
            className="text-center space-y-8"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <p
              className="text-xl md:text-2xl text-slate-600"
              style={{ fontFamily: "'Playfair Display', 'Times New Roman', serif", fontStyle: 'italic' }}
            >
              A calm, premium way to deliver life-saving intelligence.
            </p>
            <div className="space-y-5">
              <h1 className="text-5xl md:text-6xl font-semibold tracking-tight">
                Unified disaster alerts,
                <br />
                built for every Indian.
              </h1>
              <p className="text-lg md:text-xl text-slate-600 max-w-3xl mx-auto leading-relaxed">
                Suraksha Setu transforms complex data into clear, localized guidance with
                multilingual support, PIN-code precision, and research-ready insights.
              </p>
            </div>
            <div className="flex gap-4 justify-center flex-wrap">
              <Button
                size="lg"
                onClick={() => navigate('/app/dashboard')}
                className="bg-slate-900 text-white hover:bg-slate-800 text-base px-8 shadow-lg"
              >
                Get Started <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate('/app/dashboard')}
                className="text-base px-8 border-slate-300 hover:bg-slate-100"
              >
                View Dashboard
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-12 max-w-4xl mx-auto">
              {[
                { label: 'Unified Sources', value: '4+' },
                { label: 'Alert Latency', value: '<5s' },
                { label: 'Languages', value: '10+' },
                { label: 'PIN-code Ready', value: '100%' }
              ].map((stat) => (
                <Card key={stat.label} className="border border-slate-200 bg-white/70">
                  <CardContent className="pt-6 text-center">
                    <div className="text-2xl font-semibold text-slate-900">{stat.value}</div>
                    <p className="text-sm text-slate-600 mt-1">{stat.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </motion.div>
        </div>
      </section>
      </Skeleton>

      {/* Features Section */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <motion.div {...fadeInUp} className="text-center mb-12">
            <p className="text-sm uppercase tracking-widest text-slate-500">Features</p>
            <h2 className="text-4xl font-semibold mt-2">Premium clarity, engineered for scale</h2>
            <p className="text-slate-600 text-lg max-w-3xl mx-auto mt-4">
              Every module is aligned to a calm, consistent experience for citizens, students, and scientists.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                title: 'Multilingual Intelligence',
                description: 'Natural language support across Indian languages with clear, citizen-first summaries.',
                icon: <Languages className="w-6 h-6" />
              },
              {
                title: 'PIN-code Precision',
                description: 'Hyper-local warnings tuned to your exact area, delivered with minimal latency.',
                icon: <Target className="w-6 h-6" />
              },
              {
                title: 'Live Safety Maps',
                description: 'Risk overlays and evacuation guidance designed for fast comprehension.',
                icon: <Map className="w-6 h-6" />
              },
              {
                title: 'AI Summarization',
                description: 'Dense bulletins simplified into actionable steps with confidence indicators.',
                icon: <Cpu className="w-6 h-6" />
              },
              {
                title: 'Student Learning',
                description: 'Structured datasets, projects, and drills tailored to disaster education.',
                icon: <BookOpen className="w-6 h-6" />
              },
              {
                title: 'Research Exports',
                description: 'Clean CSV/PDF outputs ready for analytics, reports, and AI models.',
                icon: <Shield className="w-6 h-6" />
              }
            ].map((feature) => (
              <Card key={feature.title} className="border border-slate-200 bg-white shadow-sm">
                <CardContent className="pt-6 space-y-4">
                  <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                    {feature.icon}
                  </div>
                  <h3 className="font-semibold text-lg">{feature.title}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final Section */}
      <section className="py-20 px-4 bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div {...fadeInUp}>
            <h2 className="text-4xl md:text-5xl font-semibold mb-6">Ready to go live with confidence?</h2>
            <p className="text-slate-600 text-lg mb-8 max-w-2xl mx-auto">
              Launch the dashboard and experience a premium, unified view of disaster intelligence.
            </p>
            <div className="flex gap-4 justify-center flex-wrap">
              <Button
                size="lg"
                onClick={() => navigate('/app/dashboard')}
                className="bg-slate-900 text-white hover:bg-slate-800 text-base px-8"
              >
                Launch Dashboard <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate('/register')}
                className="text-base px-8 border-slate-300 hover:bg-slate-100"
              >
                Create Account
              </Button>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
};

export default Landing;

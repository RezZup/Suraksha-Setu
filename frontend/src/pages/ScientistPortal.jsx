import React, { useState, useEffect } from 'react';
import {
  Database,
  UploadCloud,
  LineChart,
  GitBranch,
  Microscope,
  FileText,
  Download,
  Upload,
  Play,
  Save,
  FolderOpen,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from 'sonner';
import DataExport from "@/components/scientist/DataExport";
import ResearcherChat from "@/components/scientist/ResearcherChat";
import { useAuth } from "@/contexts/AuthContext";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

const FALLBACK_MODELS = [
  { id: 'flood_prediction', name: 'Flood Prediction Model v2.1', type: 'Random Forest Regressor', description: 'Predicts water levels based on rainfall intensity and upstream dam release data.', accuracy: 94.2, status: 'active' },
  { id: 'cyclone_tracker', name: 'Cyclone Path Predictor', type: 'LSTM Neural Network', description: 'Forecasts cyclone trajectory using historical satellite imagery and wind patterns.', accuracy: 89.7, status: 'active' },
  { id: 'earthquake_early', name: 'Earthquake Early Warning', type: 'Ensemble Model', description: 'Detects P-wave anomalies to provide 10-30 second advance warning.', accuracy: 91.5, status: 'training' },
  { id: 'landslide_risk', name: 'Landslide Risk Assessment', type: 'Gradient Boosting', description: 'Analyzes soil moisture, terrain slope, and recent rainfall to predict landslide probability.', accuracy: 87.3, status: 'active' },
];

const ScientistPortal = () => {
  const { user, token } = useAuth();
  const [uploadingData, setUploadingData] = useState(false);
  const [runningSimulation, setRunningSimulation] = useState(false);
  const [selectedModel, setSelectedModel] = useState(null);
  const [models, setModels] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [exportFormat, setExportFormat] = useState('csv');
  const [payloadMode, setPayloadMode] = useState('metadata');
  const [exportLimit, setExportLimit] = useState(200000);
  const allowedRoles = new Set(['scientist', 'admin', 'developer']);
  const currentRole = String(user?.role || '').toLowerCase();
  const hasScientistPortalAccess = allowedRoles.has(currentRole);

  const getApiHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});

  useEffect(() => {
    if (!hasScientistPortalAccess) {
      setModels([]);
      setAnalytics(null);
      setAnalyticsLoading(false);
      return;
    }

    const headers = getApiHeaders();

    fetch(`${BACKEND_URL}/api/scientist/models`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.models?.length) setModels(data.models);
        else setModels(FALLBACK_MODELS);
      })
      .catch(() => setModels(FALLBACK_MODELS));

    setAnalyticsLoading(true);
    fetch(`${BACKEND_URL}/api/scientist/analytics/overview`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => setAnalytics(data))
      .catch(() => setAnalytics(null))
      .finally(() => setAnalyticsLoading(false));
  }, [token, hasScientistPortalAccess]);

  if (!hasScientistPortalAccess) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Restricted</CardTitle>
            <CardDescription>
              Only scientist, admin, and developer accounts can access the scientist portal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Current role: {currentRole || 'unknown'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const initialPortalLoading = analyticsLoading && !analytics && models.length === 0;

  if (initialPortalLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-10 w-[540px] rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="lg:col-span-2 h-[320px] rounded-xl" />
          <Skeleton className="h-[320px] rounded-xl" />
        </div>
        <Skeleton className="h-[420px] rounded-xl" />
      </div>
    );
  }

  const handleUploadDataset = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.json,.xlsx';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      setUploadingData(true);
      const formData = new FormData();
      formData.append('file', file);

      try {
        const headers = getApiHeaders();
        const response = await fetch(`${BACKEND_URL}/api/scientist/upload-dataset`, {
          method: 'POST',
          headers,
          body: formData,
          credentials: 'include'
        });

        if (response.ok) {
          toast.success(`Dataset "${file.name}" uploaded successfully`);
        } else {
          toast.error('Upload failed');
        }
      } catch (error) {
        toast.error('Error uploading dataset');
      } finally {
        setUploadingData(false);
      }
    };
    input.click();
  };

  const handleRunSimulation = async () => {
    setRunningSimulation(true);
    try {
      const headers = getApiHeaders();
      const response = await fetch(`${BACKEND_URL}/api/scientist/run-simulation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          model: selectedModel || 'flood_prediction',
          parameters: {
            timesteps: 100,
            region: 'all'
          }
        }),
        credentials: 'include'
      });

      if (response.ok) {
        const result = await response.json();
        toast.success(`Simulation completed: ${result.predictions_count} predictions generated`);
      } else {
        toast.error('Simulation failed');
      }
    } catch (error) {
      toast.error('Error running simulation');
    } finally {
      setRunningSimulation(false);
    }
  };

  const handleExportModel = async (modelId) => {
    try {
      const headers = getApiHeaders();
      const response = await fetch(`${BACKEND_URL}/api/scientist/export-model/${modelId}`, {
        headers,
        credentials: 'include'
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${modelId}_model.pkl`;
        a.click();
        window.URL.revokeObjectURL(url);
        toast.success('Model exported successfully');
      }
    } catch (error) {
      toast.error('Error exporting model');
    }
  };

  const handleImportModel = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pkl,.h5,.pt';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('file', file);

      try {
        const headers = getApiHeaders();
        const response = await fetch(`${BACKEND_URL}/api/scientist/import-model`, {
          method: 'POST',
          headers,
          body: formData,
          credentials: 'include'
        });

        if (response.ok) {
          toast.success(`Model "${file.name}" imported successfully`);
        } else {
          toast.error('Import failed');
        }
      } catch (error) {
        toast.error('Error importing model');
      }
    };
    input.click();
  };

  const models_display = models.map(m => ({
    id: m.id || m.model_id,
    name: m.name,
    type: m.model_type || m.type || '',
    description: m.description || '',
    accuracy: m.accuracy_score != null ? (m.accuracy_score * 100).toFixed(1) : m.accuracy,
    status: m.status || 'active',
  }));

  const handleExportTrainingDataset = async (datasetType) => {
    try {
      const headers = getApiHeaders();
      const params = new URLSearchParams({
        limit: String(Math.max(1, Math.min(exportLimit || 50000, 200000))),
        format: exportFormat,
        payload_mode: payloadMode,
      });
      const response = await fetch(`${BACKEND_URL}/api/scientist/datasets/export/${datasetType}?${params.toString()}`, { headers });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to export ${datasetType} dataset`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${datasetType}_${payloadMode}_dataset.${exportFormat}`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success(`${datasetType} dataset exported as ${exportFormat.toUpperCase()}`);
    } catch (error) {
      toast.error(error.message || `Error exporting ${datasetType} dataset`);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scientist Research Hub</h1>
          <p className="text-muted-foreground">Advanced data analysis, modeling, and prediction tools.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleUploadDataset}
            disabled={uploadingData}
          >
            {uploadingData ? (
              <AlertCircle className="w-4 h-4 animate-spin" />
            ) : (
              <UploadCloud className="w-4 h-4" />
            )}
            {uploadingData ? 'Uploading...' : 'Upload Dataset'}
          </Button>
          <Button
            className="gap-2"
            onClick={handleRunSimulation}
            disabled={runningSimulation}
          >
            {runningSimulation ? (
              <AlertCircle className="w-4 h-4 animate-spin" />
            ) : (
              <GitBranch className="w-4 h-4" />
            )}
            {runningSimulation ? 'Running...' : 'Run Simulation'}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="analysis" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="analysis">Data Analysis</TabsTrigger>
          <TabsTrigger value="assistant">AI Assistant</TabsTrigger>
          <TabsTrigger value="models">Predictive Models</TabsTrigger>
          <TabsTrigger value="simulation">Raw Simulation</TabsTrigger>
          <TabsTrigger value="reports">Research Reports</TabsTrigger>
          <TabsTrigger value="export">Data Export</TabsTrigger>
        </TabsList>

        <TabsContent value="analysis" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Real Dataset Ingestion Trend (14 days)</CardTitle>
                <CardDescription>Rows persisted from live external sources.</CardDescription>
              </CardHeader>
              <CardContent className="border rounded-lg p-4 space-y-3">
                {analyticsLoading ? (
                  <div className="h-[260px] flex items-center justify-center text-muted-foreground">Loading analytics...</div>
                ) : analytics?.daily_ingestion?.length ? (
                  analytics.daily_ingestion.map((d) => {
                    const maxRows = Math.max(...analytics.daily_ingestion.map(x => x.rows), 1);
                    const pct = Math.round((d.rows / maxRows) * 100);
                    return (
                      <div key={d.date}>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>{d.date}</span>
                          <span>{d.rows} rows</span>
                        </div>
                        <div className="h-2 w-full rounded bg-muted overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="h-[260px] flex items-center justify-center text-muted-foreground">No ingestion trend data yet.</div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Real Source Health</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-3 border rounded-lg">
                    <p className="text-sm font-medium">Average Quality Score</p>
                    <p className="text-2xl font-bold mt-1">{analytics?.quality?.average_quality_score ?? 0}</p>
                  </div>
                  <div className="p-3 border rounded-lg">
                    <p className="text-sm font-medium">Usable Rows</p>
                    <p className="text-2xl font-bold mt-1">{analytics?.quality?.usable_rows ?? 0}</p>
                  </div>
                  <div className="p-3 border rounded-lg">
                    <p className="text-sm font-medium">Low-Quality Rows</p>
                    <p className="text-2xl font-bold mt-1">{analytics?.quality?.low_quality_rows ?? 0}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Top Sources</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(analytics?.top_sources || []).slice(0, 5).map((s) => (
                    <div key={s.source} className="flex justify-between border rounded px-3 py-2 text-sm">
                      <span>{s.source}</span>
                      <span className="font-semibold">{s.rows}</span>
                    </div>
                  ))}
                  {(!analytics?.top_sources || analytics.top_sources.length === 0) && (
                    <p className="text-sm text-muted-foreground">No source data yet.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Dataset Coverage</CardTitle>
              <CardDescription>Rows currently available for training and evaluation.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {Object.entries(analytics?.dataset_counts || {}).filter(([k]) => k !== 'total').map(([key, value]) => (
                <div key={key} className="border rounded-lg p-3">
                  <p className="text-xs uppercase text-muted-foreground">{key}</p>
                  <p className="text-xl font-bold mt-1">{value}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assistant" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ResearcherChat />
            </div>
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Quick Tips</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-2">
                  <p>• Enable <strong>RAG mode</strong> for document-grounded answers with source citations.</p>
                  <p>• Switch to <strong>Detailed (CSV)</strong> for exportable tabular data.</p>
                  <p>• Ask for "trend analysis" or "anomaly detection" for structured reports.</p>
                  <p>• Vigyan Drishti uses NDMA, IMD, and CPCB data sources.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="models">
          <div className="mb-6 flex justify-end">
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleImportModel}
            >
              <Upload className="w-4 h-4" />
              Import Model
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
            {models_display.map((model) => (
              <Card
                key={model.id}
                className="hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => setSelectedModel(model.id)}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Microscope className="w-5 h-5 text-primary" />
                    {model.name}
                  </CardTitle>
                  <CardDescription>{model.type}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">{model.description}</p>
                  <div className="flex justify-between items-center text-sm mb-4">
                    <span className="font-medium">Accuracy: {model.accuracy}%</span>
                    <span className={`px-2 py-1 rounded text-xs ${model.status === 'active'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                      }`}>
                      {model.status === 'active' ? (
                        <><CheckCircle className="w-3 h-3 inline mr-1" />Active</>
                      ) : (
                        <><AlertCircle className="w-3 h-3 inline mr-1" />Training</>
                      )}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1">
                      <Play className="w-4 h-4 mr-1" />
                      Run Model
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportModel(model.id);
                      }}
                    >
                      <Save className="w-4 h-4 mr-1" />
                      Export
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="simulation" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Raw Data Simulation</CardTitle>
              <CardDescription>Run custom simulations with uploaded datasets and models</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-3">Simulation Parameters</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Select Model</label>
                      <select className="w-full p-2 border rounded">
                        <option>Flood Prediction Model v2.1</option>
                        <option>Cyclone Path Predictor</option>
                        <option>Earthquake Early Warning</option>
                        <option>Landslide Risk Assessment</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-2 block">Region</label>
                      <select className="w-full p-2 border rounded">
                        <option>All Regions</option>
                        <option>North India</option>
                        <option>Coastal Areas</option>
                        <option>Himalayan Belt</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-2 block">Time Steps</label>
                      <input
                        type="number"
                        defaultValue={100}
                        className="w-full p-2 border rounded"
                        min="10"
                        max="1000"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">Data Sources</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 border rounded">
                      <span className="text-sm">Historical Weather Data</span>
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="flex items-center justify-between p-3 border rounded">
                      <span className="text-sm">Sensor Grid Readings</span>
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="flex items-center justify-between p-3 border rounded">
                      <span className="text-sm">Satellite Imagery</span>
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    </div>
                    <Button variant="outline" className="w-full mt-2">
                      <FolderOpen className="w-4 h-4 mr-2" />
                      Add Custom Dataset
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleRunSimulation}
                  disabled={runningSimulation}
                >
                  {runningSimulation ? (
                    <>
                      <AlertCircle className="w-5 h-5 mr-2 animate-spin" />
                      Running Simulation...
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 mr-2" />
                      Start Simulation
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Simulation Results */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Simulations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div>
                    <p className="font-medium">Flood Prediction - Delhi NCR</p>
                    <p className="text-sm text-muted-foreground">Completed 2 hours ago • 500 predictions</p>
                  </div>
                  <Button variant="outline" size="sm">
                    <Download className="w-4 h-4 mr-1" />
                    Download
                  </Button>
                </div>
                <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div>
                    <p className="font-medium">Cyclone Track - Bay of Bengal</p>
                    <p className="text-sm text-muted-foreground">Completed 1 day ago • 1,200 predictions</p>
                  </div>
                  <Button variant="outline" size="sm">
                    <Download className="w-4 h-4 mr-1" />
                    Download
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardHeader>
                <CardTitle>Monsoon Impact Analysis 2025</CardTitle>
                <CardDescription>Comprehensive flood risk assessment</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Based on 3 months of simulation data across 12 states
                </p>
                <Button variant="outline" className="w-full">
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </Button>
              </CardContent>
            </Card>

            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardHeader>
                <CardTitle>Seismic Activity Report Q1</CardTitle>
                <CardDescription>Earthquake prediction accuracy metrics</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Analysis of 247 seismic events and model performance
                </p>
                <Button variant="outline" className="w-full">
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </Button>
              </CardContent>
            </Card>

            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardHeader>
                <CardTitle>Cyclone Pattern Study</CardTitle>
                <CardDescription>Historical trajectory analysis</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  10-year cyclone data with prediction model validation
                </p>
                <Button variant="outline" className="w-full">
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="export">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Export Options</CardTitle>
                <CardDescription>Download metadata, raw source payloads, or both in CSV/JSON format.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium mb-2 block">Format</label>
                  <select className="w-full p-2 border rounded" value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Payload Mode</label>
                  <select className="w-full p-2 border rounded" value={payloadMode} onChange={(e) => setPayloadMode(e.target.value)}>
                    <option value="metadata">Metadata Only</option>
                    <option value="raw">Raw Source Only</option>
                    <option value="both">Metadata + Raw</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Row Limit</label>
                  <input
                    type="number"
                    min="1"
                    max="200000"
                    value={exportLimit}
                    onChange={(e) => setExportLimit(Number(e.target.value) || 50000)}
                    className="w-full p-2 border rounded"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Training Dataset Exports</CardTitle>
                <CardDescription>Download stored real datasets as CSV for model training.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <Button variant="outline" className="justify-start gap-2" onClick={() => handleExportTrainingDataset('earthquake')}>
                  <Download className="w-4 h-4" /> Earthquake CSV
                </Button>
                <Button variant="outline" className="justify-start gap-2" onClick={() => handleExportTrainingDataset('flood')}>
                  <Download className="w-4 h-4" /> Flood CSV
                </Button>
                <Button variant="outline" className="justify-start gap-2" onClick={() => handleExportTrainingDataset('heatwave')}>
                  <Download className="w-4 h-4" /> Heatwave CSV
                </Button>
                <Button variant="outline" className="justify-start gap-2" onClick={() => handleExportTrainingDataset('nearby')}>
                  <Download className="w-4 h-4" /> Nearby CSV
                </Button>
                <Button variant="outline" className="justify-start gap-2" onClick={() => handleExportTrainingDataset('weather')}>
                  <Download className="w-4 h-4" /> Weather CSV
                </Button>
                <Button variant="outline" className="justify-start gap-2" onClick={() => handleExportTrainingDataset('aqi')}>
                  <Download className="w-4 h-4" /> AQI CSV
                </Button>
                <Button variant="outline" className="justify-start gap-2" onClick={() => handleExportTrainingDataset('ingestion')}>
                  <Download className="w-4 h-4" /> Source Log CSV
                </Button>
                <Button variant="outline" className="justify-start gap-2" onClick={() => handleExportTrainingDataset('mosdac')}>
                  <Download className="w-4 h-4" /> MOSDAC Metadata
                </Button>
              </CardContent>
            </Card>
            <DataExport />
          </div>
        </TabsContent>
      </Tabs>
    </div >
  );
};

export default ScientistPortal;

import React, { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Loader2,
  Database,
  CheckCircle2,
  RefreshCw,
  FileSpreadsheet,
  FileJson,
  ListChecks,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const API_URL = `${BACKEND_URL}/api`;

const DataExport = () => {
  const { token } = useAuth();
  const [catalog, setCatalog] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [selectedDatasets, setSelectedDatasets] = useState([]);
  const [exportFormat, setExportFormat] = useState('csv');
  const [payloadMode, setPayloadMode] = useState('both');
  const [rowLimit, setRowLimit] = useState(50000);
  const [exporting, setExporting] = useState(false);
  const [recentDownloads, setRecentDownloads] = useState([]);

  const getApiHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});

  const availableRows = useMemo(
    () => catalog.reduce((sum, ds) => sum + Number(ds.rows || 0), 0),
    [catalog]
  );

  const fetchCatalog = async () => {
    setLoadingCatalog(true);
    try {
      const response = await fetch(`${API_URL}/scientist/datasets/catalog?include_samples=true`, {
        headers: getApiHeaders(),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Unable to fetch dataset catalog');
      }

      const data = await response.json();
      const datasets = Array.isArray(data?.datasets) ? data.datasets : [];
      setCatalog(datasets);
      setSelectedDatasets(datasets.filter((d) => Number(d.rows || 0) > 0).map((d) => d.id));
    } catch (error) {
      toast.error(error.message || 'Failed to load dataset catalog');
      setCatalog([]);
      setSelectedDatasets([]);
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, [token]);

  const toggleDataset = (datasetId) => {
    setSelectedDatasets((prev) => (
      prev.includes(datasetId)
        ? prev.filter((id) => id !== datasetId)
        : [...prev, datasetId]
    ));
  };

  const parseFilenameFromHeader = (headerValue) => {
    if (!headerValue) return '';
    const match = headerValue.match(/filename=\"?([^\";]+)\"?/i);
    return match?.[1] || '';
  };

  const downloadDataset = async (datasetId) => {
    const params = new URLSearchParams({
      format: exportFormat,
      payload_mode: payloadMode,
      limit: String(Math.max(1, Math.min(Number(rowLimit) || 50000, 200000))),
    });

    const response = await fetch(`${API_URL}/scientist/datasets/export/${datasetId}?${params.toString()}`, {
      headers: getApiHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Failed to export dataset: ${datasetId}`);
    }

    const blob = await response.blob();
    const filenameHeader = response.headers.get('Content-Disposition');
    const fileName = parseFilenameFromHeader(filenameHeader)
      || `${datasetId}_${payloadMode}_dataset.${exportFormat}`;

    const fileUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = fileUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(fileUrl);

    setRecentDownloads((prev) => [
      {
        name: fileName,
        datasetId,
        format: exportFormat,
        mode: payloadMode,
        downloadedAt: new Date().toLocaleString(),
      },
      ...prev.slice(0, 7),
    ]);
  };

  const handleExportSelected = async () => {
    if (selectedDatasets.length === 0) {
      toast.error('Select at least one dataset to export');
      return;
    }

    setExporting(true);
    let successCount = 0;

    for (const datasetId of selectedDatasets) {
      try {
        await downloadDataset(datasetId);
        successCount += 1;
      } catch (error) {
        toast.error(error.message || `Failed export for ${datasetId}`);
      }
    }

    if (successCount > 0) {
      toast.success(`Downloaded ${successCount} dataset(s)`);
    }
    setExporting(false);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Full Dataset Export
          </CardTitle>
          <CardDescription>
            Export metadata, raw source payloads, or both from all ingested sources to build complete training datasets.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-sm font-medium mb-2 block">Format</label>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
                className="w-full p-2 border rounded"
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Payload Mode</label>
              <select
                value={payloadMode}
                onChange={(e) => setPayloadMode(e.target.value)}
                className="w-full p-2 border rounded"
              >
                <option value="metadata">Metadata Only</option>
                <option value="raw">Raw Only</option>
                <option value="both">Metadata + Raw</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Row Limit</label>
              <input
                type="number"
                min="1"
                max="200000"
                value={rowLimit}
                onChange={(e) => setRowLimit(Number(e.target.value) || 50000)}
                className="w-full p-2 border rounded"
              />
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="w-full gap-2" onClick={fetchCatalog} disabled={loadingCatalog}>
                {loadingCatalog ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Refresh Full List
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Datasets: {catalog.length}</Badge>
            <Badge variant="outline">Selected: {selectedDatasets.length}</Badge>
            <Badge variant="outline">Rows Available: {availableRows}</Badge>
          </div>

          <div className="space-y-2 border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">1. Full List: Select Datasets to Download</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedDatasets(catalog.filter((d) => Number(d.rows || 0) > 0).map((d) => d.id))}
                >
                  Select All Non-Empty
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedDatasets([])}
                >
                  Clear
                </Button>
              </div>
            </div>

            {loadingCatalog ? (
              <div className="text-sm text-muted-foreground py-6">Loading dataset catalog...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[280px] overflow-auto pr-1">
                {catalog.map((dataset) => {
                  const checked = selectedDatasets.includes(dataset.id);
                  return (
                    <label
                      key={dataset.id}
                      className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDataset(dataset.id)}
                        className="mt-1"
                      />
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{dataset.label}</p>
                        <p className="text-xs text-muted-foreground">
                          id: {dataset.id} | rows: {dataset.rows} | columns: {(dataset.columns || []).length}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          raw fields: {(dataset.raw_columns || []).join(', ') || 'none'}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <Button
            className="w-full gap-2"
            size="lg"
            onClick={handleExportSelected}
            disabled={exporting || selectedDatasets.length === 0}
          >
            {exporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Exporting Selected Datasets...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                2. Download Selected ({exportFormat.toUpperCase()} + {payloadMode})
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="w-5 h-5" />
            Full List Details
          </CardTitle>
          <CardDescription>
            Dataset inventory with schema and sample raw keys currently stored in Supabase.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {catalog.map((dataset) => (
            <div key={`detail-${dataset.id}`} className="border rounded-lg p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-sm">{dataset.label}</p>
                <div className="flex gap-2">
                  <Badge variant="outline">{dataset.rows} rows</Badge>
                  <Badge variant="outline">{(dataset.columns || []).length} columns</Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">dataset id: {dataset.id}</p>
              <p className="text-xs text-muted-foreground mt-1">
                raw columns: {(dataset.raw_columns || []).join(', ') || 'none'}
              </p>
              {(dataset.sample_raw_keys || []).length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  sample raw keys: {dataset.sample_raw_keys.slice(0, 12).join(', ')}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" />
            Recent Downloads
          </CardTitle>
          <CardDescription>
            Latest files downloaded from the scientist export endpoints.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentDownloads.length === 0 && (
            <p className="text-sm text-muted-foreground">No downloads in this session yet.</p>
          )}
          {recentDownloads.map((item, index) => (
            <div key={`${item.name}-${index}`} className="flex items-center justify-between border rounded px-3 py-2">
              <div>
                <p className="text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.downloadedAt}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {item.format === 'json' ? <FileJson className="w-4 h-4" /> : <FileSpreadsheet className="w-4 h-4" />}
                <span>{item.mode}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default DataExport;

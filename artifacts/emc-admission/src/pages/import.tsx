import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { importExcel } from '../lib/importExcel';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const { user } = useAuth();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setResult(null);
    }
  };

  const handleImport = async () => {
    if (!file || !user) return;
    
    setImporting(true);
    setProgress(0);
    setResult(null);

    try {
      const stats = await importExcel(file, user.id, user.namaLengkap, (p) => setProgress(p));
      setResult(stats);
      toast.success('Import data pasien berhasil diselesaikan.');
    } catch (err: any) {
      toast.error('Gagal melakukan import: ' + err.message);
    } finally {
      setImporting(false);
      setFile(null);
      // reset file input
      const fileInput = document.getElementById('file-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import Data Pasien</h1>
        <p className="text-muted-foreground mt-1">Perbarui data pasien rawat inap dari file Excel Sistem HIS.</p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-6">
          <div className="border-2 border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center bg-muted/20 text-center transition-colors hover:bg-muted/40">
            <FileSpreadsheet className="w-16 h-16 text-primary mb-4" />
            <h3 className="text-lg font-semibold mb-2">Upload File Excel (.xlsx)</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Pastikan format file sesuai dengan hasil export laporan pasien aktif dari sistem HIS.
              Proses ini akan otomatis memutakhirkan status pasien, ruangan, dan kelas.
            </p>
            
            <input 
              type="file" 
              id="file-upload" 
              className="hidden" 
              accept=".xlsx, .xls" 
              onChange={handleFileChange}
              disabled={importing}
            />
            <label 
              htmlFor="file-upload"
              className="cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-8"
            >
              Pilih File Excel
            </label>
            
            {file && (
              <div className="mt-4 p-3 bg-card border border-border rounded-lg text-sm font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </div>
            )}
          </div>

          {importing && (
            <div className="mt-6 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-semibold text-primary flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Memproses Data...
                </span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <Button 
              size="lg" 
              onClick={handleImport} 
              disabled={!file || importing}
              className="w-full sm:w-auto"
            >
              {importing ? 'Sedang Import...' : 'Mulai Import Data'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-emerald-500/30 shadow-sm bg-emerald-50/30 dark:bg-emerald-950/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-6 h-6" /> Hasil Import
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="bg-background p-4 rounded-lg border border-border">
                <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Total Baris</div>
                <div className="text-2xl font-bold">{result.total}</div>
              </div>
              <div className="bg-background p-4 rounded-lg border border-border">
                <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider text-emerald-600">Pasien Baru</div>
                <div className="text-2xl font-bold text-emerald-600">{result.new}</div>
              </div>
              <div className="bg-background p-4 rounded-lg border border-border">
                <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider text-blue-600">Diupdate</div>
                <div className="text-2xl font-bold text-blue-600">{result.updated}</div>
              </div>
              <div className="bg-background p-4 rounded-lg border border-border">
                <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider text-orange-600">Pulang/Arsip</div>
                <div className="text-2xl font-bold text-orange-600">{result.archived}</div>
              </div>
            </div>

            {result.errors && result.errors.length > 0 && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                <h4 className="font-semibold text-destructive flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4" /> Ada {result.errors.length} Error:
                </h4>
                <ul className="text-sm space-y-1 text-destructive/80 max-h-32 overflow-y-auto list-disc pl-5">
                  {result.errors.map((e: string, i: number) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

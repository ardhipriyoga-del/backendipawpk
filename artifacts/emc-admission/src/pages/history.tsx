import React, { useState, useEffect } from 'react';
import { getDB } from '../lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Eye, FileText, CalendarDays } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EpisodeLink } from '@/components/EpisodeLink';
import { formatDate } from '../lib/utils';

export default function HistoryPage() {
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [selectedEp, setSelectedEp] = useState<any | null>(null);
  const [epHistory, setEpHistory] = useState<any[]>([]);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const db = await getDB();
    const [allEps, allPatients] = await Promise.all([
      db.getAll('episodes'),
      db.getAll('patients'),
    ]);
    // Only show discharged / archived episodes
    // Guard legacy snapshots where a pending-discharge patient was already
    // written as a discharged episode before the confirmation flow existed.
    const discharged = allEps
      .filter(e => {
        if (e.status !== 'pulang') return false;
        const currentPatient = allPatients.find(
          p => p.noRM === e.noRM && p.episodeNo === e.episodeNo,
        );
        return currentPatient?.status !== 'pulang_pending';
      })
      .sort((a,b) => b.archivedAt - a.archivedAt);
    setEpisodes(discharged);
  };

  const openDetail = async (ep: any) => {
    const db = await getDB();
    const pends = await db.getAll('pendings');
    const relatedPends = pends.filter(p => p.episodeNo === ep.episodeNo && p.noRM === ep.noRM);
    
    setEpHistory(relatedPends.sort((a,b) => b.createdAt - a.createdAt));
    setSelectedEp(ep);
    setIsDetailOpen(true);
  };

  const filtered = episodes.filter(e => 
    e.namaPasien.toLowerCase().includes(searchTerm.toLowerCase()) || 
    e.noRM.includes(searchTerm) ||
    e.episodeNo.includes(searchTerm)
  );

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Riwayat Pasien Pulang</h1>
          <p className="text-muted-foreground mt-1">Arsip data pasien yang sudah discharge dan riwayat operannya.</p>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 border-b border-border flex items-center bg-muted/20">
          <Search className="w-5 h-5 text-muted-foreground mr-3" />
          <input 
            type="text"
            placeholder="Cari No RM, Nama Pasien, atau No IPK..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="flex-1 bg-transparent border-none focus:outline-none text-base"
          />
        </CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="text-left p-4 font-semibold">No RM / IPK</th>
                <th className="text-left p-4 font-semibold">Nama Pasien</th>
                <th className="text-left p-4 font-semibold">Tgl Masuk</th>
                <th className="text-left p-4 font-semibold">Tgl Pulang</th>
                <th className="text-right p-4 font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(ep => (
                <tr key={ep.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <td className="p-4 font-mono font-medium">{ep.noRM} <br/><span className="text-xs text-muted-foreground font-sans"><EpisodeLink episode={ep.episodeNo} /></span></td>
                  <td className="p-4 font-bold">{ep.namaPasien}</td>
                  <td className="p-4 text-muted-foreground">{formatDate(ep.admissionDate)}</td>
                  <td className="p-4 text-muted-foreground">{ep.dischargeDate ? formatDate(ep.dischargeDate) : '-'}</td>
                  <td className="p-4 text-right">
                    <Button variant="outline" size="sm" onClick={() => openDetail(ep)} className="gap-2">
                      <Eye className="w-4 h-4" /> Detail
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    Tidak ada riwayat pasien ditemukan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Riwayat Episode: {selectedEp?.namaPasien}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div className="flex gap-6 mb-6 bg-muted p-4 rounded-lg text-sm">
              <div><span className="text-muted-foreground block text-xs">No RM</span><span className="font-mono font-bold">{selectedEp?.noRM}</span></div>
              <div><span className="text-muted-foreground block text-xs">No IPK</span><span className="font-mono"><EpisodeLink episode={selectedEp?.episodeNo} /></span></div>
              <div><span className="text-muted-foreground block text-xs">Tgl Masuk</span><span>{selectedEp?.admissionDate}</span></div>
            </div>
            
            <h4 className="font-bold mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-primary"/> History Pending ({epHistory.length})</h4>
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
              {epHistory.map(p => (
                <Card key={p.id} className="shadow-none border border-border">
                  <CardContent className="p-4">
                    <div className="flex justify-between mb-2">
                      <span className="text-xs font-semibold px-2 py-1 bg-muted rounded-md">{p.kategori}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(p.createdAt)}</span>
                    </div>
                    <p className="text-sm mb-2">{p.isiPending}</p>
                    <div className="text-xs bg-muted/50 p-2 rounded border-l-2 border-primary text-muted-foreground">
                      Penyelesaian: {p.komentar?.[p.komentar.length - 1]?.text || 'Selesai tanpa komentar (diarsipkan)'}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {epHistory.length === 0 && (
                <div className="text-center p-6 text-muted-foreground border border-dashed rounded-lg">
                  Tidak ada record pending selama perawatan ini.
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

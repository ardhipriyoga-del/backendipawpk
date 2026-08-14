    <div className="p-6 space-y-4 max-w-[1600px] mx-auto pb-12">
      {/* ── Notif banner: IGD SPRI siren ── */}
      {sirenActive && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-red-300 bg-red-50/80 dark:bg-red-950/40 dark:border-red-800/50 px-5 py-3 shadow-sm animate-in fade-in slide-in-from-top-4 mb-2">
          <div className="flex items-start gap-4 min-w-0">
            <div className="p-2 bg-red-100 dark:bg-red-900/50 rounded shrink-0 animate-pulse">
               <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div className="min-w-0 pt-0.5">
              <p className="font-bold text-red-800 dark:text-red-300 text-[13px]">Pasien IGD Sudah SPRI</p>
              <p className="text-[12px] font-medium text-red-600/90 dark:text-red-400/90 truncate mt-0.5">{sirenLabel}</p>
            </div>
          </div>
          <Button onClick={stopSiren} variant="destructive" className="shrink-0 gap-2 font-bold shadow-sm rounded h-8 text-xs">
            <X className="w-3.5 h-3.5" /> Stop Peringatan
          </Button>
        </div>
      )}

      {/* ── Notif banner: Farmasi Selesai bell ── */}
      {bellActive && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-emerald-300 bg-emerald-50/80 dark:bg-emerald-950/40 dark:border-emerald-800/50 px-5 py-3 shadow-sm animate-in fade-in slide-in-from-top-4 mb-2">
          <div className="flex items-start gap-4 min-w-0">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 rounded shrink-0 animate-pulse">
               <Bell className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0 pt-0.5">
              <p className="font-bold text-emerald-800 dark:text-emerald-300 text-[13px]">Rencana Pulang — Farmasi Selesai</p>
              <p className="text-[12px] font-medium text-emerald-600/90 dark:text-emerald-400/90 truncate mt-0.5">{bellLabel}</p>
            </div>
          </div>
          <Button onClick={stopBell} className="shrink-0 gap-2 font-bold shadow-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded h-8 text-xs">
            <X className="w-3.5 h-3.5" /> Stop Peringatan
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 pb-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Dashboard Operasional</h1>
          <p className="text-[13px] font-medium text-muted-foreground max-w-xl">
            Ringkasan aktivitas pasien rawat inap, status operan, dan pemantauan IGD real-time.
          </p>
        </div>
        <Button className="gap-2.5 font-bold shadow-sm bg-emerald-600 hover:bg-emerald-700 text-white transition-all hover:shadow-md h-9 text-xs" onClick={openOperan} data-testid="button-mulai-operan">
          <Share2 className="w-4 h-4" /> Mulai Operan Shift
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard title="Pasien Aktif" value={stats.activePatients} icon={Users} color="text-blue-600 dark:text-blue-400" bg="bg-blue-100/50 dark:bg-blue-900/30" border="border-b-blue-500" />
        <StatCard title="Total Pending" value={stats.totalPending} icon={Clock} color="text-slate-600 dark:text-slate-400" bg="bg-slate-100 dark:bg-slate-800" border="border-b-slate-500" />
        <StatCard title="Selesai Hari Ini" value={stats.pendingTodayCompleted} icon={CheckCircle2} color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-100/50 dark:bg-emerald-900/30" border="border-b-emerald-500" />
        <StatCard title="Belum Selesai" value={stats.pendingUnfinished} icon={AlertTriangle} color="text-orange-600 dark:text-orange-400" bg="bg-orange-100/50 dark:bg-orange-900/30" border="border-b-orange-500" />
        <StatCard title="Pending Critical" value={stats.pendingCritical} icon={AlertCircle} color="text-red-600 dark:text-red-400" bg="bg-red-100/50 dark:bg-red-900/30" border="border-b-red-500" />
        <StatCard title="Operan Hari Ini" value={stats.operanToday} icon={Share2} color="text-primary" bg="bg-primary/10" border="border-b-primary" />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        
        {/* KTM Widget */}
        <Card className="col-span-1 lg:col-span-2 shadow-sm flex flex-col rounded-md border border-border h-[380px]">
          <CardHeader className="py-2.5 px-4 border-b border-border bg-muted/20 shrink-0">
            <CardTitle className="text-[13px] font-bold flex items-center gap-2">
              <div className="p-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                <Bell className="w-3.5 h-3.5" />
              </div>
              Pasien Rawat Inap KTM
              {ktmDashPatients.length > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                  {ktmDashPatients.filter((p: any) => p.status === 'baru').length > 0 ? `${ktmDashPatients.filter((p: any) => p.status === 'baru').length} Baru` : ktmDashPatients.length}
                </Badge>
              )}
              <a href="#/monitoring-ktm" className="ml-auto text-[11px] font-bold text-primary hover:underline transition-colors">Lihat Semua &rarr;</a>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-3 overflow-hidden flex flex-col">
            {ktmDashPatients.length === 0 ? (
              <EmptyState icon={Bell} title="Tidak ada data KTM" description="Buka Monitoring KTM untuk memulai pemantauan pasien secara real-time" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 content-start flex-1 overflow-y-auto pr-1 scrollbar-thin">
                {ktmDashPatients.map((p: any) => (
                  <div key={p.noRM} className={`group relative flex items-start gap-2.5 rounded px-3 py-2.5 transition-all border ${p.status === 'baru' ? 'bg-amber-50/50 border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-900/50' : 'bg-card border-border/50 hover:bg-muted/40'}`}>
                    {p.status === 'baru' && (
                      <span className="absolute -left-1 -top-1 flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500 border-2 border-white dark:border-background"></span>
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[13px] text-foreground truncate group-hover:text-primary transition-colors">{p.namaPasien}</span>
                        {p.status === 'baru' && <span className="shrink-0 text-[8px] font-extrabold px-1 py-0.5 rounded uppercase tracking-wider bg-amber-500 text-white">Baru</span>}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                         <span className="text-[11px] font-medium text-foreground bg-muted px-1 py-0.5 rounded">{p.noRM}</span>
                         {p.episodeNo && <span className="text-[11px] text-muted-foreground flex items-center gap-0.5"><span className="text-muted-foreground/40">•</span> Ep: <EpisodeLink episode={p.episodeNo} /></span>}
                        {(p.ruangan || p.ward) && <span className="text-[11px] text-muted-foreground flex items-center gap-0.5"><span className="text-muted-foreground/40">•</span> {p.ruangan || p.ward}</span>}
                        {p.kelas && <span className="text-[11px] text-muted-foreground flex items-center gap-0.5"><span className="text-muted-foreground/40">•</span> {p.kelas}</span>}
                      </div>
                      {p.dpjp && (
                        <p className="text-[10px] font-medium text-muted-foreground mt-1.5 truncate flex items-center gap-1 bg-muted/30 w-max px-1.5 py-0.5 rounded border border-border/40">
                          <Users className="w-2.5 h-2.5 text-muted-foreground/70" /> {p.dpjp}
                        </p>
                      )}
                    </div>
                    {p.tanggalJamKTM && (
                      <div className="shrink-0 text-right mt-0.5">
                        <span className="inline-flex text-[9px] font-bold text-muted-foreground whitespace-nowrap bg-muted px-1.5 py-0.5 rounded">{p.tanggalJamKTM}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* IGD SPRI Panel */}
        <Card className="col-span-1 shadow-sm flex flex-col rounded-md border border-border h-[380px]">
          <CardHeader className="py-2.5 px-4 border-b border-border bg-muted/20 shrink-0">
            <CardTitle className="text-[13px] font-bold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400">
                  <Activity className="w-3.5 h-3.5" />
                </div>
                IGD ke SPRI
                <Badge variant="secondary" className={`ml-0.5 px-1.5 py-0 text-[10px] font-bold ${igdPatients.length > 0 ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300 border-red-200 dark:border-red-800' : 'bg-muted text-muted-foreground'}`}>
                  {igdPatients.length}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {igdLastFetch && <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider hidden sm:inline-block">Update: {igdLastFetch}</span>}
                <button onClick={fetchIGD} disabled={igdLoading} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors" title="Refresh">
                  <RefreshCw className={`w-3.5 h-3.5 ${igdLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-3 overflow-hidden flex flex-col">
            {igdError && (
              <div className="flex items-center gap-2 text-[11px] font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded p-2 mb-3 shrink-0">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {igdError}
              </div>
            )}
            {igdLoading && igdPatients.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span className="text-[11px] font-medium">Memuat data IGD...</span>
              </div>
            )}
            {!igdLoading && igdPatients.length === 0 && !igdError ? (
              <EmptyState icon={CheckCircle2} title="Semua Pasien Terlayani" description="Tidak ada antrean pasien IGD ber-SPRI saat ini." colorClass="bg-emerald-100/50 dark:bg-emerald-900/20 text-emerald-500" />
            ) : (
              <div className="space-y-2 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                {igdPatients.map(p => {
                  const timerStyle = IGD_TIMER_STYLE[p.timerColor] ?? IGD_TIMER_STYLE[''];
                  return (
                    <div key={p.noRM} className="group flex items-center justify-between p-2.5 rounded border border-border/50 bg-card hover:bg-muted/40 transition-all">
                      <div className="min-w-0 pr-2">
                        <p className="text-[13px] font-bold truncate text-foreground group-hover:text-primary transition-colors">{p.nama}</p>
                        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
                          <span className="font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">{p.noRM}</span>
                          <span className="text-muted-foreground/40">•</span>
                          <span className="truncate font-medium">{p.lokasi}</span>
                        </div>
                      </div>
                      <div className={`shrink-0 flex items-center justify-center min-w-[3rem] px-1.5 py-1 rounded border tabular-nums text-[12px] font-bold ${timerStyle}`}>
                        {p.timerTransfer}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rencana Pasien Pulang */}
        <Card className="col-span-1 lg:col-span-2 shadow-sm flex flex-col rounded-md border border-border h-[380px]">
          <CardHeader className="py-2.5 px-4 border-b border-border bg-muted/20 shrink-0">
            <CardTitle className="text-[13px] font-bold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
                Rencana Pasien Pulang
                <Badge variant="secondary" className={`ml-0.5 px-1.5 py-0 text-[10px] font-bold ${dischargePlan.length > 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-muted text-muted-foreground'}`}>
                  {dischargePlan.length}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {dischargeLastFetch && <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider hidden sm:inline-block">Update: {dischargeLastFetch}</span>}
                <button onClick={fetchDischargePlan} disabled={dischargeLoading} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors" title="Refresh">
                  <RefreshCw className={`w-3.5 h-3.5 ${dischargeLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-3 p-3 overflow-hidden">
            <Input placeholder="Cari No. RM, Nama, atau Ruang..." value={dischargeSearch} onChange={e => setDischargeSearch(e.target.value)} className="h-8 text-[12px] bg-muted/30 focus-visible:bg-transparent rounded shrink-0" />
            
            {dischargeError && (
              <div className="flex items-center gap-2 text-[11px] font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded p-2 shrink-0">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {dischargeError}
              </div>
            )}

            {dischargeLoading && dischargePlan.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span className="text-[11px] font-medium">Memuat data rencana pulang...</span>
              </div>
            )}

            {(() => {
              const q = dischargeSearch.toLowerCase();
              const filtered = dischargePlan.filter(p => !q || p.noRM.toLowerCase().includes(q) || p.namaPasien.toLowerCase().includes(q) || p.ruang.toLowerCase().includes(q) || p.payor.toLowerCase().includes(q));

              if (!dischargeLoading && filtered.length === 0 && !dischargeError) {
                return <EmptyState icon={CheckCircle2} title={dischargeSearch ? 'Tidak ada hasil pencarian' : 'Belum ada rencana pulang'} description="Data akan otomatis muncul ketika ada update" />;
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 content-start flex-1 overflow-y-auto pr-1 scrollbar-thin">
                  {filtered.map((p) => {
                    const meta = DISCHARGE_STATUS_META[p.status];
                    const Icon = meta.icon;
                    return (
                      <div key={p.noRM} className="group flex items-start gap-2.5 p-2.5 rounded border border-border/50 bg-card hover:bg-muted/40 transition-all">
                        <div className={`mt-0.5 p-1.5 rounded border bg-background shadow-sm ${meta.iconColor}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-foreground group-hover:text-primary transition-colors truncate">{p.namaPasien}</p>
                          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
                            <span className="font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">{p.noRM}</span>
                            <span className="text-muted-foreground/40">•</span>
                            <span className="truncate font-medium">Rg. {p.ruang}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/40">
                            <span className={`inline-flex items-center text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider border ${meta.badgeClass}`}>{meta.label}</span>
                            {p.payor && <span className="truncate text-[9px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50 max-w-[100px]">{p.payor}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Just Info Aktif */}
        <Card className="col-span-1 shadow-sm flex flex-col rounded-md border border-border h-[380px]">
          <CardHeader className="py-2.5 px-4 border-b border-border bg-muted/20 shrink-0">
            <CardTitle className="text-[13px] font-bold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400">
                  <Info className="w-3.5 h-3.5" />
                </div>
                Just Info Aktif
                {activeJustInfosDash.length > 0 && (
                  <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                    {activeJustInfosDash.length}
                  </Badge>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-3 overflow-hidden flex flex-col">
            {activeJustInfosDash.length === 0 ? (
              <EmptyState icon={Info} title="Tidak ada Just Info" description="Seluruh catatan observasi sudah ditindaklanjuti" />
            ) : (
              <div className="space-y-2 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                {activeJustInfosDash.map(j => (
                  <div key={j.id} className="group flex items-start gap-2.5 p-2.5 rounded border border-border/50 bg-card hover:bg-muted/40 transition-all">
                    <div className="mt-0.5 p-1.5 rounded border bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 shrink-0 border-blue-100 dark:border-blue-800/50">
                      <Info className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[13px] font-bold text-foreground group-hover:text-primary transition-colors truncate">{j.namaPasien}</p>
                        <span className="text-[9px] font-bold text-muted-foreground whitespace-nowrap bg-muted px-1.5 py-0.5 rounded">
                          {new Date(j.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-1 mb-2 text-[11px] text-muted-foreground">
                        <span className="font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">{j.noRM}</span>
                        {j.shift && <span className="flex items-center gap-1"><span className="text-muted-foreground/40">•</span> Shift {j.shift}</span>}
                        {j.userName && <span className="truncate flex items-center gap-1"><span className="text-muted-foreground/40">•</span> {j.userName}</span>}
                      </div>
                      <p className="text-[12px] text-foreground/90 line-clamp-3 leading-relaxed bg-muted/30 p-2 rounded border border-border/50">
                        {j.isi}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

with open('artifacts/emc-admission/src/pages/dashboard.tsx', 'r') as f:
    content = f.read()

old_statcard = """function StatCard({ title, value, icon: Icon, color, bg, border }: any) {
  return (
    <Card className={`shadow-sm transition-all duration-200 hover:shadow-md border-l-[4px] border-y-0 border-r-0 rounded-md group ${border}`}>
      <CardContent className="p-4 flex items-center gap-4 h-full min-h-[80px]">
        <div className={`p-2.5 rounded-lg shrink-0 ${bg}`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider truncate mb-0.5">{title}</p>
          <h3 className="text-2xl font-black tracking-tight text-foreground leading-none">{value}</h3>
        </div>
      </CardContent>
    </Card>
  );
}"""

new_statcard = """function StatCard({ title, value, icon: Icon, color, bg, border }: any) {
  return (
    <Card className={`shadow-sm transition-all duration-200 hover:shadow-md border-b-[3px] border-t-0 border-x-0 rounded-md group ${border}`}>
      <CardContent className="p-3.5 flex items-center gap-3.5 h-full min-h-[76px]">
        <div className={`p-2 rounded-md shrink-0 ${bg}`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider truncate mb-0.5">{title}</p>
          <h3 className="text-xl font-black tracking-tight text-foreground leading-none">{value}</h3>
        </div>
      </CardContent>
    </Card>
  );
}"""

if old_statcard in content:
    content = content.replace(old_statcard, new_statcard)
    with open('artifacts/emc-admission/src/pages/dashboard.tsx', 'w') as f:
        f.write(content)
    print("StatCard updated")
else:
    print("StatCard not found or already updated")

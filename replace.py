import re

with open('artifacts/emc-admission/src/pages/dashboard.tsx', 'r') as f:
    content = f.read()

# We want to replace from `return (\n    <div className="p-6` up to `      {/* ===== DIALOG OPERAN SHIFT ===== */}`
# with the contents of new_ui.tsx

with open('new_ui.tsx', 'r') as f:
    new_ui = f.read()

# find the start of the return block
start_idx = content.find('  return (\n    <div className="p-6')
if start_idx == -1:
    print("Start not found")

# find the dialog comment
end_idx = content.find('      {/* ===== DIALOG OPERAN SHIFT ===== */}')
if end_idx == -1:
    print("End not found")

new_content = content[:start_idx] + '  return (\n' + new_ui + '\n' + content[end_idx:]

# Also add EmptyState component at the bottom of the file
empty_state = """
function EmptyState({ icon: Icon, title, description, colorClass }: any) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground bg-muted/10 rounded border border-dashed border-border/60">
      <div className={`p-2.5 rounded ${colorClass || 'bg-muted'}`}>
        <Icon className="w-6 h-6 opacity-60" />
      </div>
      <div className="text-center px-4">
        <p className="text-[13px] font-semibold text-foreground/80 mb-0.5">{title}</p>
        <p className="text-[11px] max-w-[220px] mx-auto leading-tight">{description}</p>
      </div>
    </div>
  );
}
"""
if "function EmptyState" not in new_content:
    new_content += empty_state

with open('artifacts/emc-admission/src/pages/dashboard.tsx', 'w') as f:
    f.write(new_content)

print("Replaced successfully")

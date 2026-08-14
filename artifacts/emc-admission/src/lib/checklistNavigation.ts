const CHECKLIST_FILTER_INTENT_KEY = 'ipaw:checklist-filter-intent';
export const CHECKLIST_FILTER_INTENT_EVENT = 'ipaw:checklist-filter-intent';

export type ChecklistFilterIntent = 'today';

export function requestChecklistFilter(filter: ChecklistFilterIntent): void {
  try {
    window.sessionStorage.setItem(CHECKLIST_FILTER_INTENT_KEY, filter);
  } catch {
    // Restricted browser storage must not prevent navigation to the checklist.
  }
  window.dispatchEvent(new CustomEvent(CHECKLIST_FILTER_INTENT_EVENT, { detail: filter }));
}

export function consumeChecklistFilter(): ChecklistFilterIntent | null {
  try {
    const value = window.sessionStorage.getItem(CHECKLIST_FILTER_INTENT_KEY);
    window.sessionStorage.removeItem(CHECKLIST_FILTER_INTENT_KEY);
    return value === 'today' ? value : null;
  } catch {
    return null;
  }
}
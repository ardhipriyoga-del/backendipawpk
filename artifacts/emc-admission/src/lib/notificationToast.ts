import { toast } from 'sonner';
import type { Action, ExternalToast } from 'sonner';
import { stopNotificationSound } from './notificationSettings';

type PersistentToastType = 'info' | 'warning' | 'error' | 'success';

type PersistentNotificationOptions = Omit<
  ExternalToast,
  'duration' | 'action' | 'onDismiss' | 'onAutoClose'
> & {
  action?: Action;
};

/**
 * Use this only for alert notifications that are paired with a sound.
 * The alert remains visible until the user swipes it, closes it, or responds
 * through its action. Every dismissal path stops the active notification sound.
 */
export function showPersistentNotification(
  type: PersistentToastType,
  message: string,
  options: PersistentNotificationOptions = {},
): string | number {
  let toastId: string | number | undefined;
  const originalAction = options.action;
  const action = originalAction
    ? {
        ...originalAction,
        onClick: (event: Parameters<Action['onClick']>[0]) => {
          stopNotificationSound();
          originalAction.onClick(event);
          if (toastId !== undefined) toast.dismiss(toastId);
        },
      }
    : undefined;

  toastId = toast[type](message, {
    ...options,
    className: [options.className, 'persistent-notification-toast'].filter(Boolean).join(' '),
    action,
    duration: Infinity,
    onDismiss: () => stopNotificationSound(),
    onAutoClose: () => stopNotificationSound(),
  });

  return toastId;
}
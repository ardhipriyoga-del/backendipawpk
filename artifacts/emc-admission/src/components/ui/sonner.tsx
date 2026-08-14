'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';
import { BellRing } from 'lucide-react';
import { useEffect, type ComponentProps } from 'react';
import { stopNotificationSound } from '@/lib/notificationSettings';

type ToasterProps = ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  useEffect(() => {
    const stopSoundWhenPersistentToastIsClicked = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.persistent-notification-toast')) {
        stopNotificationSound();
      }
    };

    document.addEventListener('click', stopSoundWhenPersistentToastIsClicked, true);
    return () => document.removeEventListener('click', stopSoundWhenPersistentToastIsClicked, true);
  }, []);

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
             'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-xl group-[.toaster]:py-3',
           title: 'group-[.toast]:text-sm group-[.toast]:font-semibold',
           description: 'group-[.toast]:text-xs group-[.toast]:leading-relaxed group-[.toast]:text-muted-foreground',
           icon: 'group-[.toast]:text-primary',
          actionButton:
             'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-md group-[.toast]:text-xs group-[.toast]:font-semibold',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
         className: 'notification-toast',
      }}
       icons={{ info: <BellRing className="h-4 w-4" />, warning: <BellRing className="h-4 w-4" /> }}
      {...props}
    />
  );
};

export { Toaster };
